# AisleFlow — Design Document

A single shared shopping list as a web app. Material Design UI. Unchecked items appear above checked items; unchecked items are manually ordered via drag and drop, checked items are sorted alphabetically, and an item's manual position survives being checked and unchecked.

**Stack:** Go backend · PostgreSQL in Docker · React frontend (Vite + TypeScript + MUI). Database lifecycle managed via `make`.

---

## 1. Overview

### Goals

- One shared shopping list, editable by anyone with access to the app (household-scale).
- Fast add / check / uncheck / reorder / delete interactions with optimistic UI.
- Unchecked items rendered above checked items.
- Unchecked items ordered manually by drag and drop.
- Checked items ordered alphabetically (case-insensitive).
- **Order preservation:** checking an item and later unchecking it returns it to its previous position among the unchecked items.
- Changes propagate across open tabs/devices via polling (a few seconds of latency is acceptable).
- Material Design look and feel throughout.

### Non-goals

- Authentication or user accounts — the app is open (intended for home-network or personal deployment).
- Multiple lists.
- Real-time push (WebSockets/SSE).
- Offline support / PWA.
- Item metadata beyond a name (no quantities, categories, notes, or images).

These are all listed as [future extensions](#12-future-extensions); the design deliberately leaves room for them without requiring them now.

---

## 2. User Experience

### Layout

A single screen, mobile-first, max content width ~600 px centered on larger screens.

```
┌─────────────────────────────────────┐
│  AisleFlow                    [⋮]   │  ← AppBar (primary color)
├─────────────────────────────────────┤
│  [ Add an item…              ] (+)  │  ← Add bar (TextField + submit)
├─────────────────────────────────────┤
│  ⠿ ☐ Milk                           │  ┐
│  ⠿ ☐ Bread                          │  │ Unchecked section
│  ⠿ ☐ Coffee beans                   │  │ (drag handles, manual order)
│  ⠿ ☐ Tomatoes                       │  ┘
│  ─────────────────────────────────  │  ← Divider
│    ☑ ~~Apples~~                     │  ┐
│    ☑ ~~Butter~~                     │  │ Checked section
│    ☑ ~~Yogurt~~                     │  ┘ (alphabetical, no handles)
└─────────────────────────────────────┘
```

### MUI components

| UI element | Component |
|---|---|
| Top bar | `AppBar` + `Toolbar` |
| Add bar | `TextField` + `IconButton` (`AddIcon`), or `Fab` on mobile |
| Item rows | `List` / `ListItem` + `Checkbox` + `ListItemText` |
| Drag handle | `DragIndicatorIcon` (unchecked rows only) |
| Section divider | `Divider` |
| Delete | `IconButton` (`DeleteOutlineIcon`) revealed on hover / always visible on touch |
| Clear checked | Menu item under the AppBar `⋮` menu, with a confirm `Dialog` |
| Errors | `Snackbar` + `Alert` |
| Theme | `ThemeProvider` with a standard Material palette; respect `prefers-color-scheme` for light/dark |

### Interactions

- **Add:** type a name, press Enter or tap (+). The item appends to the *bottom of the unchecked section*. Input clears and keeps focus so several items can be added in a row. Leading/trailing whitespace is trimmed; empty input is ignored.
  - If the name already exists (case-insensitive) and is **checked**, the item is unchecked instead of duplicated — it reappears at its preserved position.
  - If it already exists and is **unchecked**, nothing is created; the existing row is briefly highlighted so the user sees it's already on the list.
- **Check:** tap the checkbox. The row animates out of the unchecked section and into its alphabetical slot in the checked section (strikethrough, dimmed).
- **Uncheck:** tap the checkbox of a checked item. It returns to the unchecked section **at its preserved position** (see §3).
- **Reorder:** drag an unchecked row by its handle. Only the unchecked section is sortable; rows cannot be dragged into the checked section. During a drag, polling updates are paused (see §7).
- **Delete:** per-row delete icon removes the item permanently. No confirm dialog for a single item (low stakes; the item can be retyped).
- **Clear checked:** removes all checked items at once, behind a confirmation dialog.

### Empty states

- Whole list empty: friendly centered message ("Your list is empty — add your first item above").
- No checked items: checked section and divider are hidden entirely.
- No unchecked items but some checked: divider + checked section only, with a small "All done! 🎉" note in place of the unchecked section.

---

## 3. Ordering Model

This is the core of the app, so it gets its own section.

### The invariant

Every item — checked or not — carries a persistent numeric `position`. **Checking or unchecking an item never modifies its `position`.** That single rule yields the required behavior:

- Unchecked items are displayed sorted by `position` ascending.
- Checked items are displayed sorted by `lower(name)` ascending; their `position` is ignored for display but retained.
- When an item is unchecked, it naturally reappears among the unchecked items wherever its retained `position` places it — i.e., where it was before it was checked (relative to the items that are still there).

### Position values

`position` is a `double precision`. Values are sparse so reordering is a single-row update:

- **New item:** `position = max(position over all items) + 1024` (or `1024` if the table is empty). New items therefore land at the bottom of the unchecked section. The max is taken over *all* items, including checked ones, so a new item can never collide with or sort before a checked item's preserved slot.
- **Drag and drop:** the moved item's `position` becomes the midpoint of its new neighbors' positions. Dropped at the top of the unchecked section: `first.position - 1024`. Dropped at the bottom: `last.position + 1024` — using only *unchecked* neighbors, since that is what the user sees. This can place the item between two checked items' preserved positions, which is fine: display order for unchecked items only depends on their order relative to each other.
- Ties (two equal positions, possible via races) are broken by `created_at, id` so ordering stays deterministic.

### Renormalization

Repeated midpoint insertion in the same gap halves the gap each time; after ~50 splits a float64 midpoint stops producing distinct values. This is practically unreachable for a shopping list, but the design handles it anyway:

- When the backend computes a reorder and finds `abs(new - neighbor) < 1e-6`, it renormalizes inside the same transaction: rewrite **all** items' positions to `1024, 2048, 3072, …` following the current canonical order (unchecked by position first, then checked by position), then re-applies the move.
- Renormalization preserves relative order of every item, checked ones included, so preservation semantics are unaffected.

To keep this logic in one place, the *backend* computes positions: the client's reorder request names the target neighbors, not a raw float (see §6, `PATCH` with `before`/`after`). The client still computes a midpoint locally for its optimistic render, but the server's value is authoritative and comes back in the response.

### Worked example

List (top→bottom): Milk(1024) Bread(2048) Eggs(3072) Jam(4096).

1. Check *Bread* → unchecked shows Milk, Eggs, Jam; checked shows Bread. Bread keeps 2048.
2. Drag *Jam* between Milk and Eggs → Jam.position = midpoint(1024, 3072) = 2048 … equal to Bread's. Allowed (ties broken deterministically); display of unchecked items is unaffected because Bread isn't shown among them.
3. Uncheck *Bread* → unchecked sorted by position: Milk(1024), Jam(2048)/Bread(2048) tie-broken by created_at → Milk, Bread, Jam, Eggs. Bread is back adjacent to where it used to be, which is the intended "preserved" behavior in the presence of intervening reorders.

---

## 4. System Architecture

```
┌──────────────────────┐      JSON /api/*       ┌───────────────────┐      SQL (pgx)      ┌───────────────────┐
│  React SPA           │ ─────────────────────▶ │  Go HTTP server   │ ──────────────────▶ │  PostgreSQL 16    │
│  Vite + TS + MUI     │ ◀───────────────────── │  net/http, :8081  │ ◀────────────────── │  Docker container │
│  TanStack Query      │   poll every ~4 s       │                   │                     │  named volume     │
└──────────────────────┘                         └───────────────────┘                     └───────────────────┘
```

- **Development:** Vite dev server on `:5174` proxies `/api` to the Go server on `:8081` (no CORS needed). Postgres runs via `docker compose`, managed by `make`.
- **Production (simple deployment):** `vite build` output is embedded in the Go binary with `embed.FS` and served by the same server that serves `/api` — one binary + one Postgres container. (SPA fallback: unknown non-`/api` paths serve `index.html`.)
- Concurrency model: last-write-wins on all mutations. No locking or versioning — acceptable at household scale, and the polling loop reconciles clients within seconds.

---

## 5. Data Model

One table. Migrations live in `db/migrations/` (see §9).

```sql
-- 000001_create_items.up.sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       citext NOT NULL,
    checked    boolean NOT NULL DEFAULT false,
    position   double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT items_name_unique UNIQUE (name),
    CONSTRAINT items_name_not_blank CHECK (btrim(name) <> '')
);

-- Serves the two display orderings.
CREATE INDEX items_position_idx ON items (position);
CREATE INDEX items_checked_name_idx ON items (checked, name);
```

Notes:

- `citext` gives case-insensitive uniqueness and comparison ("Milk" ≡ "milk") without `lower()` gymnastics. The original casing the user typed is preserved for display.
- `name` uniqueness is what powers the create-or-revive behavior in §2/§6.
- `updated_at` is maintained by the store layer on every mutation (no trigger needed at this scale).
- No soft deletes; `DELETE` is a real delete.

---

## 6. API Specification

JSON over HTTP under `/api`. No auth. All responses are JSON; mutations return the affected item so the client can reconcile optimistic state.

### Types

```ts
interface Item {
  id: string;          // uuid
  name: string;
  checked: boolean;
  position: number;
  createdAt: string;   // RFC 3339
  updatedAt: string;   // RFC 3339
}
```

### Endpoints

| Method & path | Body | Success | Purpose |
|---|---|---|---|
| `GET /api/items` | — | `200` `{ "items": Item[] }` | Full list. Server returns display order: unchecked by `position, created_at, id`, then checked by `name`. |
| `POST /api/items` | `{ "name": string }` | `201` `{ "item": Item, "revived": false }` — created<br>`200` `{ "item": Item, "revived": true }` — existing checked item was unchecked<br>`200` `{ "item": Item, "revived": false }` — already unchecked, no-op | Create-or-revive. Name is trimmed server-side; blank → `422`. |
| `PATCH /api/items/{id}` | any subset of:<br>`{ "name": string }`<br>`{ "checked": boolean }`<br>`{ "before": id \| null, "after": id \| null }` | `200` `{ "item": Item }` | Rename, check/uncheck, and/or reorder. `before`/`after` name the unchecked neighbors at the drop location (`null` = edge of the unchecked section); the **server** computes the new `position` (§3). |
| `DELETE /api/items/{id}` | — | `204` | Delete one item. |
| `DELETE /api/items?checked=true` | — | `200` `{ "deleted": number }` | Clear all checked items. Without the query param → `400` (guards against wiping the list). |
| `GET /api/healthz` | — | `200` `{ "status": "ok" }` | Liveness + DB ping. |

### Errors

Uniform shape, appropriate status codes:

```json
{ "error": { "code": "not_found", "message": "item not found" } }
```

- `400 bad_request` — malformed JSON, invalid uuid, missing `?checked=true`.
- `404 not_found` — unknown item id (including a `before`/`after` id that vanished; client refetches).
- `409 conflict` — rename collides with an existing name.
- `422 invalid` — blank name.
- `500 internal` — anything else; details logged server-side, never leaked.

Race notes: `POST` uses `INSERT … ON CONFLICT (name)` + follow-up logic in one transaction, so two clients adding "Milk" simultaneously converge to one row. Reorder against a just-deleted neighbor returns `404`; the client rolls back the optimistic move and refetches.

---

## 7. Frontend Design

### Stack

- **Vite + React 18 + TypeScript**
- **MUI (@mui/material, @mui/icons-material)** — Material Design components and theming
- **@dnd-kit/core + @dnd-kit/sortable** — drag and drop (actively maintained, works with MUI, keyboard-accessible)
- **TanStack Query (@tanstack/react-query)** — server state, polling, optimistic updates
- No Redux/Zustand: the only client-only state is the add-input text, a "dragging" flag, and dialog visibility — plain `useState` suffices. Everything else is server state owned by TanStack Query.

### Component tree

```
<App>                         theme, QueryClientProvider, Snackbar host
 ├─ <TopBar>                  AppBar; ⋮ menu → "Clear checked…"
 ├─ <AddItemBar>              controlled TextField; useAddItem mutation
 └─ <ShoppingList>            useItems query; splits into unchecked/checked
     ├─ <UncheckedList>       DndContext + SortableContext
     │   └─ <ItemRow sortable>  drag handle, checkbox, name, delete
     ├─ <Divider>
     └─ <CheckedList>
         └─ <ItemRow>           checkbox, struck-through name, delete
```

### Data layer (`src/api/`)

- `useItems()` — `useQuery({ queryKey: ['items'], refetchInterval: 4000, refetchOnWindowFocus: true })`. Polling is **paused while a drag is in progress or a mutation is in flight** (`refetchInterval` callback form) so a refetch can't yank rows mid-drag.
- Mutations (`useAddItem`, `useUpdateItem`, `useDeleteItem`, `useClearChecked`) all follow the standard TanStack optimistic pattern: `onMutate` cancels in-flight queries and patches the `['items']` cache; `onError` restores the snapshot and shows a Snackbar; `onSettled` invalidates to reconcile with the server (picking up the server-computed `position`).
- Sorting is done client-side from the flat `items` array (`unchecked: sort by position` / `checked: sort by localeCompare(name)`), matching the server's order — so an optimistic check/uncheck lands the row in the right place without waiting for the network.

### Drag and drop specifics

- `verticalListSortingStrategy`; the sortable area is the unchecked section only.
- On `dragEnd`, compute the neighbor ids at the drop index and call `PATCH {before, after}`; optimistically set a midpoint position locally.
- dnd-kit's keyboard sensor is enabled (drag handle focusable, space to lift, arrows to move) for accessibility.

### Visual details

- Check/uncheck animates via a shared-layout transition (CSS transform transitions on reflow; `AnimatePresence`-style libraries not required).
- Checked rows: `text-decoration: line-through`, `color: text.secondary`.
- Duplicate-add highlight: temporarily set a `flash` class on the existing row (2 s background pulse) and scroll it into view.

---

## 8. Backend Design

### Stack and layout

Go ≥ 1.22, standard library HTTP with method-aware `ServeMux` patterns — no web framework. `pgx/v5` with `pgxpool` for Postgres.

```
backend/
├─ cmd/server/main.go        flag/env parsing, pool init, graceful shutdown
├─ internal/api/             HTTP layer
│  ├─ router.go              mux := http.NewServeMux(); mux.Handle("GET /api/items", …)
│  ├─ handlers.go            decode → validate → store call → encode
│  ├─ errors.go              the {error:{code,message}} envelope, status mapping
│  └─ middleware.go          request logging (slog), panic recovery
├─ internal/store/           data layer — owns all SQL and the position algorithm
│  ├─ store.go               Store struct over *pgxpool.Pool
│  ├─ items.go               List, CreateOrRevive, Update, Delete, ClearChecked
│  └─ position.go            midpoint computation + renormalization (§3)
└─ internal/webui/           embed.FS of the built frontend (production)
```

### Key decisions

- **Position logic lives in `store`**, executed inside transactions: `Update` with a reorder reads the neighbors' positions `FOR UPDATE`, computes the midpoint, renormalizes if the gap is exhausted, and writes — atomically. Handlers never touch position math.
- **Config via env vars:** `DATABASE_URL` (default `postgres://aisleflow:aisleflow@localhost:5432/aisleflow?sslmode=disable`), `PORT` (default `8081`). No config files.
- **Logging:** `log/slog` JSON handler; one line per request (method, path, status, duration).
- **Graceful shutdown:** trap SIGINT/SIGTERM, `server.Shutdown(ctx)`, close the pool.
- **Migrations are not run by the server**; they're an explicit `make db-migrate` step (§9). The server fails fast on startup if the schema is missing (health check query).

---

## 9. Database & Operations

### docker-compose.yml

```yaml
services:
  db:
    image: postgres:16
    container_name: aisleflow-db
    environment:
      POSTGRES_USER: aisleflow
      POSTGRES_PASSWORD: aisleflow
      POSTGRES_DB: aisleflow
    ports:
      - "5432:5432"
    volumes:
      - aisleflow-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aisleflow"]
      interval: 2s
      timeout: 2s
      retries: 15

volumes:
  aisleflow-data:
```

### Migrations

Plain SQL files in `db/migrations/`, named `NNNNNN_description.{up,down}.sql`, applied with **golang-migrate** run via its Docker image (no local install required):

```
docker run --rm -v $(PWD)/db/migrations:/migrations --network host \
  migrate/migrate -path=/migrations -database "$(DATABASE_URL)" up
```

Initial migration: `000001_create_items` (schema from §5).

### Makefile

The four DB lifecycle targets from the concept, plus dev conveniences:

| Target | Action |
|---|---|
| `make db-create` | `docker compose up -d db` then wait for the healthcheck — creates container, volume, and database on first run |
| `make db-start` | `docker compose start db` (or `up -d`, idempotent) |
| `make db-migrate` | apply pending migrations via golang-migrate (above) |
| `make db-stop` | `docker compose stop db` |
| `make db-destroy` | `docker compose down -v` — delete everything (explicit, never implied) |
| `make backend` | `cd backend && go run ./cmd/server` |
| `make frontend` | `cd frontend && npm run dev` |
| `make dev` | db-create + db-migrate, then backend & frontend concurrently |
| `make test` | `go test ./...` + `npm test` |

---

## 10. Repository Layout

```
aisle-flow/
├─ CONCEPT.md
├─ DESIGN.md                 ← this document
├─ Makefile
├─ docker-compose.yml
├─ db/
│  └─ migrations/
│     ├─ 000001_create_items.up.sql
│     └─ 000001_create_items.down.sql
├─ backend/                  Go module (see §8)
└─ frontend/                 Vite app (see §7)
   └─ src/
      ├─ api/                fetch client, query/mutation hooks, Item type
      ├─ components/         TopBar, AddItemBar, ShoppingList, ItemRow, …
      ├─ theme.ts
      └─ main.tsx
```

---

## 11. Testing Strategy

### Backend

- **Store integration tests** against a real Postgres (the docker-compose instance, or [testcontainers-go] if preferred): exercise `CreateOrRevive` dedup/revive paths, `ClearChecked`, and — most importantly — the ordering model:
  - check → uncheck restores relative order (the §3 worked example as a table test);
  - midpoint reorder between arbitrary neighbors;
  - forced renormalization (seed positions `1.0` and `1.0 + 1e-7`, insert between, assert all positions rewritten and order preserved);
  - concurrent `POST` of the same name converges to one row.
- **Handler tests** with `httptest` against a store backed by the test DB: status codes, error envelope shape, `?checked=true` guard.

### Frontend

- **Vitest + React Testing Library**, mocking the API with MSW:
  - list splits/sorts correctly (unchecked by position, checked alphabetically);
  - checking an item moves it to the checked section optimistically;
  - add-duplicate highlights instead of duplicating;
  - failed mutation rolls back and shows the error Snackbar.
- Drag-and-drop ordering is verified through the `dragEnd` handler unit (given a drop index, the right `before`/`after` ids are sent) rather than simulating pointer events.

### End-to-end (lightweight)

A single happy-path script (Playwright, optional) run against `make dev`: add three items, reorder, check one, uncheck it, assert it returns to its slot, clear checked.

---

## 12. Future Extensions

Explicitly out of scope now; the design leaves seams for them:

- **Multiple lists** — add a `lists` table and `list_id FK` on `items`; the name-uniqueness constraint becomes `UNIQUE (list_id, name)`; URL gains a list picker.
- **Auth** — no-auth is isolated to "there's no middleware"; a session or shared-token middleware slots into `internal/api/middleware.go` without touching handlers.
- **Push updates** — replace polling with SSE (`GET /api/events`); TanStack Query invalidation on event keeps the rest of the frontend unchanged.
- **Item metadata** — quantity/note columns are additive migrations; `ItemRow` grows secondary text.
- **PWA/offline** — service worker + mutation queue; last-write-wins semantics already tolerate delayed replays.
