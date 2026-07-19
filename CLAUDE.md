# AisleFlow

Several shared shopping lists (household-scale, no auth); each list behaves like an independent single list. Go backend + PostgreSQL (Docker) + React/Vite/TypeScript/MUI frontend with TanStack Query + react-router. **DESIGN.md is the authoritative design doc** — code comments cite its sections (§3 ordering, §6 API, §7 frontend, §8 backend, §13 offline); keep those references valid when editing either side.

## Commands

```bash
make dev                  # cold start: db + migrate + backend + frontend
make -j2 backend frontend # when the db container is already up (usual case)
make test                 # go test ./... + vitest (backend tests need the db)
make build                # prod: vite build → embed in Go binary (-tags embedui) → backend/server
cd frontend && npm run lint   # oxlint
cd frontend && npx tsc -b     # typecheck (also covers src/test)
```

- **Ports: frontend 5174, backend 8081, Postgres 5434.** 5173/8080 belong to other projects on this machine. Vite proxies `/api` → 8081.
- Dev DB: Docker container `aisleflow-db`, usually left running. Ready check: `curl -sf http://localhost:8081/api/lists`.
- **The dev DB holds a real grocery list.** When driving the app (see `.claude/skills/verify`), only create/gesture on throwaway `ZZZ …` items and delete them afterwards.

## Architecture

- `backend/internal/api/` — HTTP layer (stdlib `ServeMux`, method-prefixed patterns). Error envelope `{error:{code,message}}` mapped in `errors.go`.
- `backend/internal/store/` — owns **all** SQL and the position algorithm; handlers never touch position math. Mutations run in transactions.
- `backend/internal/webui/` — embedded prod frontend; `webui_embed.go` is build-tagged `embedui` (compile-check with `go build -tags embedui ./...` after copying `frontend/dist` in, or just `make build`).
- `frontend/src/api/` — data layer: `client.ts` (fetch wrapper, typed `ApiError`), `queryClient.ts` (QueryClient factory + **all mutation logic as keyed mutation defaults**), `hooks.ts` (thin `mutationKey`-only bindings), `sort.ts`/`reorder.ts` (client mirrors of server ordering/position).
- `db/migrations/` — golang-migrate SQL pairs, applied via `make db-migrate` (never by the server). The test-DB helper (`backend/internal/testdb`) applies **all** `*.up.sql` in order, so a new migration needs no code change there.

## Invariants and gotchas

- **Everything is scoped per list.** Routes nest items under their list: `/api/lists/{listId}/items…`. Store methods all take a `listID`; the reorder/`renormalize` SQL filters by `list_id` (unscoped, it would corrupt other lists' ordering). The current list lives in the URL (`/l/{listId}`); an item addressed through the wrong list's prefix → 404.
- **Checking/unchecking never modifies `position`** — that one rule powers order preservation (§3). Positions are server-computed; reorder requests name neighbor ids (`before`/`after`), not floats.
- **Mutation logic must stay in `queryClient.ts` mutation defaults, not inline in hooks or components.** Offline-queued mutations are dehydrated to localStorage and resumed after reload; only defaults registered by key survive that round trip (§13). Component-level `mutate(vars, callbacks)` callbacks won't run for resumed mutations — that includes **navigation, which must happen in the component around `mutate()`, never in a callback.**
- **`listId` must travel inside item-mutation vars** (`{listId, id, …}`), not a closure — vars are what the persister serializes, so a resumed mutation re-derives its `['items', listId]` key and URL from them.
- Item and list ids are client-generated (`crypto.randomUUID()`) and sent in `POST /api/lists[/{id}/items]` so offline *add → check* and *new list → add items* chains work; the optimistic id is the real id.
- Concurrency is last-write-wins everywhere; no version guards. Accepted trade-offs are listed at the end of §13 — don't "fix" them casually.
- `name` is `citext UNIQUE (list_id, name)`: per-list uniqueness (same name may live in two lists). Create-or-revive converges duplicate adds within a list onto one row (a checked duplicate gets unchecked, `revived: true`).
- **Deleting the only remaining list is refused** (`409 last_list`, guarded in `store.DeleteList` under a `FOR UPDATE` lock). The persister `buster` is `v2`; bump it again on any cache-shape change.
- The service worker is prod-only (`devOptions.enabled: false`); verify SW behavior against `make build` + `./backend/server`, not the Vite dev server. Playwright's `setOffline` does **not** set `navigator.onLine` on freshly loaded documents — override it via init script when testing reload-while-offline.
- Frontend tests: Node's experimental `localStorage` global shadows jsdom's, so `src/test/setup.ts` installs an in-memory Storage and clears it (plus `onlineManager`) between tests. MSW handlers live in `src/test/server.ts`.
