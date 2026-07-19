# AisleFlow — Design Document

A set of shared shopping lists as a web app. Material Design UI. Each list is independent; within a list, unchecked items appear above checked items; unchecked items are manually ordered via drag and drop, checked items are sorted alphabetically, and an item's manual position survives being checked and unchecked.

**Stack:** Go backend · PostgreSQL in Docker · React frontend (Vite + TypeScript + MUI). Database lifecycle managed via `make`.

---

## 1. Overview

### Goals

- Several named shared shopping lists (e.g. Groceries, Hardware), editable by anyone with access to the app (household-scale). Each list behaves exactly like the single list described throughout this document; ordering, revive, and offline semantics are all scoped per list.
- Fast add / check / uncheck / reorder / delete interactions with optimistic UI.
- Unchecked items rendered above checked items.
- Unchecked items ordered manually by drag and drop.
- Checked items ordered alphabetically (case-insensitive).
- **Order preservation:** checking an item and later unchecking it returns it to its previous position among the unchecked items.
- Changes propagate across open tabs/devices via polling (a few seconds of latency is acceptable).
- Material Design look and feel throughout.
- **Offline-tolerant** (grocery stores have bad reception): the app installs as a PWA, renders the last-known list without a connection, and queues mutations made offline for replay on reconnect (§13).

### Non-goals

- Authentication or user accounts — the app is open (intended for home-network or personal deployment). Lists are not private from one another; anyone with the app can see and switch between all lists.
- Real-time push (WebSockets/SSE).
- Item metadata beyond a name (no quantities, categories, notes, or images).

These are all listed as [future extensions](#12-future-extensions); the design deliberately leaves room for them without requiring them now.

---

## 2. User Experience

### Layout

A single screen, mobile-first, max content width ~600 px centered on larger screens.

```
┌─────────────────────────────────────┐
│  Groceries ▾                  [⋮]   │  ← AppBar: list name = dropdown
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
| List switcher | AppBar title is a `Button` (current list name + `ArrowDropDownIcon`) opening a `Menu`: one item per list + "New list…" |
| List management | `⋮` menu: "Rename list…", "Delete list…" (disabled when only one list) |
| New/Rename list | shared `ListNameDialog` (`Dialog` + `TextField`) |
| Add bar | `TextField` + `IconButton` (`AddIcon`), or `Fab` on mobile |
| Item rows | `List` / `ListItem` + `Checkbox` + `ListItemText` |
| Drag handle | `DragIndicatorIcon` (unchecked rows only) |
| Section divider | `Divider` |
| Delete | `IconButton` (`DeleteOutlineIcon`) revealed on hover / always visible on touch |
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

### Lists

- **Switch:** tap the list name in the AppBar; a menu lists every list (the current one checked). Selecting one navigates to `/l/{listId}`. The last-viewed list is remembered (localStorage) and reopened on the next visit.
- **New list:** "New list…" in the same menu opens a name dialog; on submit the app creates the list (client-generated id, so an offline *new list → add items* chain works) and navigates to it.
- **Rename:** "Rename list…" in the `⋮` menu; a blank or duplicate name is rejected (`422`/`409`).
- **Delete:** "Delete list…" in the `⋮` menu, behind a confirm dialog naming the item count; deleting cascades the list's items. The app navigates to a surviving list first, then issues the delete. **Deleting the only remaining list is refused** (the menu item is disabled, and the server guards it with `409 last_list`).

### Empty states

- Whole list empty: friendly centered message ("Your list is empty — add your first item above").
- No checked items: checked section and divider are hidden entirely.
- No unchecked items but some checked: divider + checked section only, with a small "All done! 🎉" note in place of the unchecked section.

---

## 3. Ordering Model

This is the core of the app, so it gets its own section. **Everything here is scoped to a single list:** `position` values, the max-position used for new items, and renormalization all operate within one `list_id`; two lists never share or influence each other's ordering.

### The invariant

Every item — checked or not — carries a persistent numeric `position`. **Checking or unchecking an item never modifies its `position`.** That single rule yields the required behavior:

- Unchecked items are displayed sorted by `position` ascending.
- Checked items are displayed sorted by `lower(name)` ascending; their `position` is ignored for display but retained.
- When an item is unchecked, it naturally reappears among the unchecked items wherever its retained `position` places it — i.e., where it was before it was checked (relative to the items that are still there).

### Position values

`position` is a `double precision`. Values are sparse so reordering is a single-row update:

- **New item:** `position = max(position over all items in the list) + 1024` (or `1024` if the list is empty). New items therefore land at the bottom of the unchecked section. The max is taken over *all* items in the list, including checked ones, so a new item can never collide with or sort before a checked item's preserved slot.
- **Drag and drop:** the moved item's `position` becomes the midpoint of its new neighbors' positions. Dropped at the top of the unchecked section: `first.position - 1024`. Dropped at the bottom: `last.position + 1024` — using only *unchecked* neighbors, since that is what the user sees. This can place the item between two checked items' preserved positions, which is fine: display order for unchecked items only depends on their order relative to each other.
- Ties (two equal positions, possible via races) are broken by `created_at, id` so ordering stays deterministic.

### Renormalization

Repeated midpoint insertion in the same gap halves the gap each time; after ~50 splits a float64 midpoint stops producing distinct values. This is practically unreachable for a shopping list, but the design handles it anyway:

- When the backend computes a reorder and finds `abs(new - neighbor) < 1e-6`, it renormalizes inside the same transaction: rewrite **all of that list's** items' positions to `1024, 2048, 3072, …` following the current canonical order (unchecked by position first, then checked by position), then re-applies the move. The rewrite is scoped by `list_id`, so other lists are untouched.
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
- **Production (simple deployment):** `vite build` output is embedded in the Go binary with `embed.FS` and served by the same server that serves `/api` — one binary + one Postgres container. (SPA fallback: unknown non-`/api` paths serve `index.html`.) Hashed `assets/` are served `Cache-Control: immutable`; everything else (`index.html`, `sw.js`, manifest) is `no-cache` so service-worker updates roll out on the next visit.
- Concurrency model: last-write-wins on all mutations. No locking or versioning — acceptable at household scale, and the polling loop reconciles clients within seconds. The same property is what makes offline replay safe enough (§13).

---

## 5. Data Model

Two tables. Migrations live in `db/migrations/` (see §9).

```sql
-- 000001_create_items.up.sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE items ( … );  -- see migration 000002 for the current shape

-- 000002_create_lists.up.sql
CREATE TABLE lists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       citext NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT lists_name_unique UNIQUE (name),
    CONSTRAINT lists_name_not_blank CHECK (btrim(name) <> '')
);

-- items after migration 000002:
--   + list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE
--   name uniqueness is now per list, not global
CREATE TABLE items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id    uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
    name       citext NOT NULL,
    checked    boolean NOT NULL DEFAULT false,
    position   double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT items_list_name_unique UNIQUE (list_id, name),
    CONSTRAINT items_name_not_blank CHECK (btrim(name) <> '')
);

-- Serves the two display orderings, per list.
CREATE INDEX items_list_position_idx     ON items (list_id, position);
CREATE INDEX items_list_checked_name_idx ON items (list_id, checked, name);
```

Notes:

- `citext` gives case-insensitive uniqueness and comparison ("Milk" ≡ "milk") without `lower()` gymnastics. The original casing the user typed is preserved for display.
- Name uniqueness is **per list** (`UNIQUE (list_id, name)`) — the same name may appear in different lists, and it is per-list uniqueness that powers the create-or-revive behavior in §2/§6.
- `ON DELETE CASCADE` means deleting a list removes its items in one statement; the server refuses to delete the last remaining list (§6).
- Migration `000002_create_lists` seeds a list named **"Groceries"** and backfills every pre-existing item into it, so the upgrade is data-preserving. Its down migration is lossy: it collapses cross-list name duplicates (keeping the oldest) before restoring the global unique constraint.
- `updated_at` is maintained by the store layer on every mutation (no trigger needed at this scale).
- No soft deletes; `DELETE` is a real delete.

---

## 6. API Specification

JSON over HTTP under `/api`. No auth. All responses are JSON; mutations return the affected item so the client can reconcile optimistic state.

### Types

```ts
interface List {
  id: string;          // uuid
  name: string;
  createdAt: string;   // RFC 3339
  updatedAt: string;   // RFC 3339
}

interface Item {
  id: string;          // uuid
  listId: string;      // uuid
  name: string;
  checked: boolean;
  position: number;
  createdAt: string;   // RFC 3339
  updatedAt: string;   // RFC 3339
}
```

### Endpoints

Item endpoints are nested under their list. An item id addressed through the wrong list's prefix returns `404` (list-membership check).

| Method & path | Body | Success | Purpose |
|---|---|---|---|
| `GET /api/lists` | — | `200` `{ "lists": List[] }` | All lists, oldest first. |
| `POST /api/lists` | `{ "name": string, "id"?: uuid }` | `201` `{ "list": List }` | Create a list. Name trimmed; blank → `422`; duplicate → `409`. Optional client-generated `id` (§13). |
| `PATCH /api/lists/{listId}` | `{ "name": string }` | `200` `{ "list": List }` | Rename. Blank → `422`; duplicate → `409`. |
| `DELETE /api/lists/{listId}` | — | `204` | Delete a list and (cascade) its items. Deleting the only remaining list → `409 last_list`. |
| `GET /api/lists/{listId}/items` | — | `200` `{ "items": Item[] }` | The list's items in display order: unchecked by `position, created_at, id`, then checked by `name`. Unknown list → `404`. |
| `POST /api/lists/{listId}/items` | `{ "name": string, "id"?: uuid }` | `201` `{ "item": Item, "revived": false }` — created<br>`200` `{ "item": Item, "revived": true }` — existing checked item was unchecked<br>`200` `{ "item": Item, "revived": false }` — already unchecked, no-op | Create-or-revive within the list. Name is trimmed server-side; blank → `422`. The optional `id` lets offline clients generate the uuid themselves so queued follow-up mutations can reference the item before the response arrives (§13); an `id` colliding with a different name → `409`; unknown list → `404`. |
| `PATCH /api/lists/{listId}/items/{id}` | any subset of:<br>`{ "name": string }`<br>`{ "checked": boolean }`<br>`{ "before": id \| null, "after": id \| null }` | `200` `{ "item": Item }` | Rename, check/uncheck, and/or reorder. `before`/`after` name the unchecked neighbors at the drop location (`null` = edge of the unchecked section); the **server** computes the new `position` (§3). |
| `DELETE /api/lists/{listId}/items/{id}` | — | `204` | Delete one item. |
| `GET /api/healthz` | — | `200` `{ "status": "ok" }` | Liveness + DB ping. |

### Errors

Uniform shape, appropriate status codes:

```json
{ "error": { "code": "not_found", "message": "item not found" } }
```

- `400 bad_request` — malformed JSON, invalid uuid.
- `404 not_found` — unknown item or list id (including a `before`/`after` id that vanished, or an item addressed through the wrong list; client refetches).
- `409 conflict` — rename/create collides with an existing name.
- `409 last_list` — refused delete of the only remaining list.
- `422 invalid` — blank name.
- `500 internal` — anything else; details logged server-side, never leaked.

Race notes: `POST` uses `INSERT … ON CONFLICT (list_id, name)` + follow-up logic in one transaction, so two clients adding "Milk" to the same list simultaneously converge to one row. `DeleteList` locks all list rows `FOR UPDATE` and counts them before deleting, so two concurrent deletes of the last two lists cannot both succeed. Reorder against a just-deleted neighbor returns `404`; the client rolls back the optimistic move and refetches.

---

## 7. Frontend Design

### Stack

- **Vite + React 18 + TypeScript**
- **MUI (@mui/material, @mui/icons-material)** — Material Design components and theming
- **react-router-dom** — client routing; the current list lives in the URL (`/l/{listId}`)
- **@dnd-kit/core + @dnd-kit/sortable** — drag and drop (actively maintained, works with MUI, keyboard-accessible)
- **TanStack Query (@tanstack/react-query)** — server state, polling, optimistic updates
- **vite-plugin-pwa + @tanstack/react-query-persist-client** — service worker, cache/queue persistence (§13)
- No Redux/Zustand: the only client-only state is the add-input text, a "dragging" flag, and dialog visibility — plain `useState` suffices. Everything else is server state owned by TanStack Query.

### Routing

- `/l/:listId` renders `<ListScreen>` for that list. Any other path (including `/`) renders `<RootRedirect>`, which waits for the `['lists']` query and forwards to the last-viewed list (localStorage `aisleflow-last-list`) if it still exists, else the first list.
- A `listId` that isn't among the loaded lists (bad URL, or a list deleted on another device) is bounced back through `<RootRedirect>` with a "List not found" snackbar. The redirect is briefly debounced so a just-created list — present optimistically in the cache before its `POST` lands — is not mistaken for missing.
- In production the Go server's SPA fallback serves `index.html` for unknown non-`/api` paths, so deep links to `/l/{id}` work on a cold load.

### Component tree

```
<App>                         theme, persist provider, Router, Snackbar host
 └─ <ListScreen listId>       reads :listId; guards deleted/unknown lists
     ├─ <TopBar>              list-name dropdown (switch/new), ⋮ menu (rename/delete/clear)
     │   └─ <ListNameDialog>  shared by "New list" and "Rename list"
     ├─ <AddItemBar>          controlled TextField; useAddItem(listId) mutation
     └─ <ShoppingList>        useItems(listId) query; splits into unchecked/checked
         ├─ <UncheckedList>   DndContext + SortableContext
         │   └─ <ItemRow sortable>  drag handle, checkbox, name, delete
         ├─ <Divider>
         └─ <CheckedList>
             └─ <ItemRow>       checkbox, struck-through name, delete
```

### Data layer (`src/api/`)

- Query keys: `['lists']` for the list collection, and `['items', listId]` per list (`itemsKey(listId)`). `useLists()` and `useItems(listId)` both `useQuery({ refetchInterval: 4000, refetchOnWindowFocus: true })`, with polling **paused while a drag is in progress or a mutation is in flight or queued** (`refetchInterval` callback form) so a refetch can't yank rows mid-drag.
- Item mutations (`useAddItem`, `useUpdateItem`, `useDeleteItem`) and list mutations (`useAddList`, `useRenameList`, `useDeleteList`) all follow the standard TanStack optimistic pattern: `onMutate` cancels in-flight queries and patches the cache; `onError` restores the snapshot and shows a Snackbar; `onSettled` invalidates to reconcile with the server (picking up the server-computed `position`). The mutation functions and this optimistic plumbing live in **keyed mutation defaults** on the QueryClient (`src/api/queryClient.ts`), not inline in the hooks — a requirement of offline persistence (§13); the hooks bind by `mutationKey` only.
- **`listId` travels inside every item mutation's vars** (`{ listId, id, … }`), not captured from a closure: vars are what the persister serializes, so a mutation resumed after a reload re-derives its `['items', listId]` key and request URL from them alone. The `optimistic()` helper reads `vars.listId` to target the right cache entry.
- Sorting is done client-side from a list's flat `items` array (`unchecked: sort by position` / `checked: sort by localeCompare(name)`), matching the server's order — so an optimistic check/uncheck lands the row in the right place without waiting for the network.

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
│  ├─ router.go              mux := http.NewServeMux(); mux.Handle("GET /api/lists/{listId}/items", …)
│  ├─ handlers.go            decode → validate → store call → encode
│  ├─ errors.go              the {error:{code,message}} envelope, status mapping
│  └─ middleware.go          request logging (slog), panic recovery
├─ internal/store/           data layer — owns all SQL and the position algorithm
│  ├─ store.go               Store struct over *pgxpool.Pool; Item, List types
│  ├─ lists.go               ListLists, CreateList, RenameList, DeleteList
│  ├─ items.go               ListItems, CreateOrRevive, Update, Delete (all take listID)
│  └─ position.go            midpoint computation + per-list renormalization (§3)
└─ internal/webui/           embed.FS of the built frontend (production)
```

### Key decisions

- **Position logic lives in `store`**, executed inside transactions: `Update` with a reorder reads the neighbors' positions `FOR UPDATE`, computes the midpoint, renormalizes if the gap is exhausted, and writes — atomically. Handlers never touch position math. Every store method is scoped to a `listID`; the reorder/renormalize SQL filters by `list_id` so one list can never disturb another's positions.
- **Last-list guard lives in the store:** `DeleteList` runs in a transaction that locks all list rows `FOR UPDATE`, so the "you can't delete the only list" check is race-free.
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

Migrations: `000001_create_items` (initial schema) and `000002_create_lists` (adds the `lists` table and `items.list_id`, seeds "Groceries", makes name uniqueness per-list — schema from §5).

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
│     ├─ 000001_create_items.{up,down}.sql
│     └─ 000002_create_lists.{up,down}.sql
├─ backend/                  Go module (see §8)
└─ frontend/                 Vite app (see §7)
   └─ src/
      ├─ api/                fetch client, query/mutation hooks, Item & ListInfo types
      ├─ components/         RootRedirect, ListScreen, TopBar, ListNameDialog, AddItemBar, ShoppingList, ItemRow, …
      ├─ theme.ts
      └─ main.tsx
```

---

## 11. Testing Strategy

### Backend

- **Store integration tests** against a real Postgres (the docker-compose instance, or [testcontainers-go] if preferred): exercise `CreateOrRevive` dedup/revive paths and — most importantly — the ordering model:
  - check → uncheck restores relative order (the §3 worked example as a table test);
  - midpoint reorder between arbitrary neighbors;
  - forced renormalization (seed positions `1.0` and `1.0 + 1e-7`, insert between, assert all positions rewritten and order preserved) — and that a *second* list with the same tight positions is left untouched;
  - concurrent `POST` of the same name converges to one row.
- **List tests:** list CRUD; duplicate name → conflict; the same name coexisting in two lists; revive scoped to one list; deleting a list cascades its items; the last-list guard (including two concurrent deletes leaving exactly one list).
- **Handler tests** with `httptest` against a store backed by the test DB: status codes, error envelope shape, list lifecycle, `409 last_list`, unknown-list and wrong-list `404`s. The test-DB helper applies **all** migrations in `db/migrations/` in order.

### Frontend

- **Vitest + React Testing Library**, mocking the API with MSW:
  - list splits/sorts correctly (unchecked by position, checked alphabetically);
  - checking an item moves it to the checked section optimistically;
  - add-duplicate highlights instead of duplicating;
  - failed mutation rolls back and shows the error Snackbar;
  - offline queue (§13): mutations made while `onlineManager` is offline send nothing and replay on reconnect against the correct list, and a *create → check* chain replays in order against the client-generated uuid;
  - lists: switching from the AppBar dropdown changes the URL and rendered items; creating a list navigates to it; renaming reflects in the title; deleting navigates to a surviving list and is disabled when only one remains; a bad `/l/{id}` redirects with a snackbar; `/` redirects to a list.
- Tests open on `/l/{DEFAULT_LIST_ID}` (via `history.pushState`) to skip the redirect, except the one asserting the `/` redirect; `setup.ts` resets `window.history` between tests.
- Drag-and-drop ordering is verified through the `dragEnd` handler unit (given a drop index, the right `before`/`after` ids are sent) rather than simulating pointer events.

### End-to-end (lightweight)

A single happy-path script (Playwright, optional) run against `make dev`: add three items, reorder, check one, uncheck it, assert it returns to its slot.

---

## 12. Future Extensions

Explicitly out of scope now; the design leaves seams for them:

- **Auth** — no-auth is isolated to "there's no middleware"; a session or shared-token middleware slots into `internal/api/middleware.go` without touching handlers.
- **Push updates** — replace polling with SSE (`GET /api/events`); TanStack Query invalidation on event keeps the rest of the frontend unchanged.
- **Item metadata** — quantity/note columns are additive migrations; `ItemRow` grows secondary text.

---

## 13. Offline & PWA

The app is installable and usable in a store with no reception: the shell and last-known list render offline, and mutations made offline queue locally and replay on reconnect. Two independent layers deliver this.

### Layer 1: service worker (assets)

`vite-plugin-pwa` in `generateSW` mode (config in `frontend/vite.config.ts`):

- **Precache** of the built app shell (`registerType: 'autoUpdate'` — new versions activate silently on the next visit; `no-cache` headers on `sw.js`/`index.html` in §4 make that prompt).
- **Runtime cache** for `GET /api/lists` and each list's `GET /api/lists/{id}/items`: `NetworkFirst` with a 3 s timeout, `maxEntries: 16` (room for the lists response plus several lists' items) — belt-and-braces for a cold SW-served load; the persisted query cache below is the primary offline data source.
- Manifest + icons (rendered from `favicon.svg`); `devOptions.enabled: false` — dev stays SW-free, the worker is exercised against the prod build.
- The SW never sees mutations; queuing is the app's job (Workbox Background Sync was rejected: replies never reach the app, so the create response and optimistic reconciliation would be lost).

### Layer 2: mutation queue (TanStack Query paused mutations)

React Query pauses mutations while `onlineManager` reports offline; `PersistQueryClientProvider` + `createSyncStoragePersister` (in `App.tsx`) dehydrate the query cache **and paused mutations** to localStorage (`aisleflow-cache`, short `throttleTime` so a tap just before the tab dies still lands). On startup or reconnect, `resumePausedMutations()` replays the queue, then invalidates `['lists']` and every `['items', …]` query.

Requirements that follow, and where they live:

- **Mutation logic must be re-attachable after a reload** — inline `mutationFn`s aren't serialized. All mutation functions + optimistic plumbing are registered as keyed `setMutationDefaults` in `src/api/queryClient.ts`; hooks bind by key. Component-level `mutate(vars, callbacks)` callbacks would not run for resumed mutations, so nothing meaningful may live there — **navigation (switching to a new/surviving list) happens in the component before/after `mutate()`, never in a callback.**
- **listId lives in vars** — a resumed item mutation must know which list it targets; `listId` is part of every item-mutation's serialized vars (not a closure), so the default re-derives the `['items', listId]` key and the nested request URL.
- **Client-generated ids (items and lists)** — an offline *add → check* chain (and an offline *new list → add items* chain) needs a usable id before the server replies, so `useAddItem`/`useAddList` generate the uuid (`crypto.randomUUID()`) and `POST /api/lists[/{id}/items]` accept it (§6). The optimistic id **is** the real id; no remapping.
- **Replay ordering** — all list and item mutations share one scope (`scope: { id: 'items' }`), so the queue replays serially in FIFO order; a *create-list* therefore always replays before adds into that list.
- **Replay failure policy** — network errors retry (and re-pause if the connection drops again); HTTP `ApiError`s fail fast: the stale mutation drops out of the queue, `onSettled` invalidates, server truth wins. Covers a reorder whose neighbor vanished (404) and name conflicts (409).
- **Rollback after reload** — the `onMutate` snapshot context doesn't survive a reload; `onError` falls back to invalidate-only, which is correct because the persisted cache already holds the optimistic state.
- **Online state must be seeded** — `onlineManager` assumes online at startup and only reacts to window events, so a page *loaded* offline would fail mutations instead of queuing them; `main.tsx` seeds it from `navigator.onLine`. The TopBar shows an "Offline" chip driven by the same manager.

### Accepted last-write-wins caveats

Household-scale trade-offs, chosen deliberately:

- A queued `PATCH` replayed later overwrites whatever the row holds then — LWW means *last to arrive*. No version guard.
- A replayed add of a name that was checked in the meantime revives (unchecks) it — consistent with the §6 create-or-revive semantics.
- Idempotence: check/uncheck writes absolute values and deletes tolerate 404, so duplicate replays converge; a replayed create converges on the existing row via the name conflict.
- **Upgrade cost:** the persister `buster` bumped from `v1` to `v2` for this change, so on the first load of the new version the pre-upgrade cache **and any mutations still queued in the old (listless) format are discarded** — a one-time loss, acceptable at household scale.
