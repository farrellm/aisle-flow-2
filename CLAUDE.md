# AisleFlow

Several shared shopping lists (household-scale, no auth); each list behaves like an independent single list. Go backend + PostgreSQL (Docker) + React/Vite/TypeScript/MUI frontend with TanStack Query + react-router. **DESIGN.md is the authoritative design doc** — code comments cite its sections (§3 ordering, §6 API, §7 frontend, §8 backend, §13 offline); keep those references valid when editing either side.

## Commands

```bash
make dev                  # cold start: db + migrate + backend + frontend
make -j2 backend frontend # when the db container is already up (usual case)
make test                 # go test ./... + vitest (backend tests need the db)
make e2e                  # offline/PWA Playwright suite: prod build + own `aisleflow_e2e` db on :8082
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
- `frontend/src/api/` — data layer: `client.ts` (fetch wrapper, typed `ApiError`), `queryClient.ts` (QueryClient factory + **all mutation logic as keyed mutation defaults**), `hooks.ts` (thin `mutationKey`-only bindings), `sort.ts`/`reorder.ts` (client mirrors of server ordering/position), `notify.ts` (app-error pub-sub + the global drag flag).
- `db/migrations/` — golang-migrate SQL pairs, applied via `make db-migrate` (never by the server). The test-DB helper (`backend/internal/testdb`) applies **all** `*.up.sql` in order, so a new migration needs no code change there.

## Invariants and gotchas

- **Everything is scoped per list.** Routes nest items under their list: `/api/lists/{listId}/items…`. Store methods all take a `listID`; the reorder/`renormalize` SQL filters by `list_id` (unscoped, it would corrupt other lists' ordering). The current list lives in the URL (`/l/{listId}`); an item addressed through the wrong list's prefix → 404.
- **Checking/unchecking never modifies `position`** — that one rule powers order preservation (§3). Positions are server-computed; reorder requests name neighbor ids (`before`/`after`), not floats.
- **Drag-drop reorder is frame-sensitive: four coupled pieces, not four independent tweaks** (§3/§7). `notifyManager.setScheduler((cb) => cb())` (global, `queryClient.ts`) so an optimistic cache write re-renders in the drop's own React commit; `applyReorderOptimistic` writing the new position *synchronously in the drop handler*; its `cancelQueries(…, { revert: false })` discarding an in-flight poll that would otherwise land the pre-drop order; `animateLayoutChanges: () => false` in `ItemRow`. Persistence still routes through the `['updateItem']` mutation, whose `onMutate` re-applies the same position idempotently. Dropping any one reintroduces a visible jump or flash.
- Both queries poll every 4s but pause while a drag is active, while any mutation is in flight, or while offline (`isDragging()` / `client.isMutating()` / `onlineManager.isOnline()` in `hooks.ts`) — a refetch mid-drag would yank rows.
- **Offline, a GET must never overwrite cached data** (§13). The service worker's `api-items` response is older than the restored query cache and blind to queued writes, so applying it erases the user's unsent edits. Three gates keep that from happening and they belong together: `refetchOnMount` only when `query.state.data === undefined`, focus/poll refetch only when online (both `hooks.ts`), and the post-restore `invalidateQueries` in `App.tsx` skipped while offline. Queries are `networkMode: 'offlineFirst'` + `retry: false` — `offlineFirst` is what makes the SW cache reachable at all (cold start), `retry: false` is what keeps a cache-less cold start from hanging on a spinner forever.
- **A failed request means offline, not a failed mutation.** `client.ts` throws `NetworkError` (never reached the server) vs `ApiError` (the server said no) and marks `onlineManager` offline on the former, so the mutation re-pauses with its optimistic write intact instead of rolling back. Recovery is a 4s `GET /api/healthz` probe — `/api/healthz` because it's the one API path the SW runtime cache doesn't match, so it can't be answered from cache while the network is dead. Don't "simplify" the probe onto `/api/lists`.
- **Mutation logic must stay in `queryClient.ts` mutation defaults, not inline in hooks or components.** Offline-queued mutations are dehydrated to localStorage and resumed after reload; only defaults registered by key survive that round trip (§13). Component-level `mutate(vars, callbacks)` callbacks won't run for resumed mutations — that includes **navigation, which must happen in the component around `mutate()`, never in a callback.**
- **`listId` must travel inside item-mutation vars** (`{listId, id, …}`), not a closure — vars are what the persister serializes, so a resumed mutation re-derives its `['items', listId]` key and URL from them.
- Item and list ids are client-generated (`crypto.randomUUID()`) and sent in `POST /api/lists[/{id}/items]` so offline *add → check* and *new list → add items* chains work; the optimistic id is the real id.
- Concurrency is last-write-wins everywhere; no version guards. Accepted trade-offs are listed at the end of §13 — don't "fix" them casually.
- `name` is `citext UNIQUE (list_id, name)`: per-list uniqueness (same name may live in two lists). Create-or-revive converges duplicate adds within a list onto one row (a checked duplicate gets unchecked, `revived: true`).
- **Deleting the only remaining list is refused** (`409 last_list`, guarded in `store.DeleteList` under a `FOR UPDATE` lock). The persister `buster` is `v3`; bump it again on any cache-shape change (including retiring a mutation key — a queued mutation with no registered default rejects `resumePausedMutations`).
- The service worker is prod-only (`devOptions.enabled: false`); verify SW behavior with `make e2e` (or `make build` + `./backend/server`), never the Vite dev server. It runs in `prompt` mode — registration lives in `UpdatePrompt`, **not** `main.tsx`, and the first-ever load is uncontrolled (no `clientsClaim`), so e2e helpers reload once to get a controlled page.
- e2e gotchas (`frontend/e2e/helpers.ts`): Playwright's `setOffline` does **not** set `navigator.onLine` on freshly loaded documents — the `navigator.onLine` init-script shim is what keeps the reload-while-offline test from silently passing on the online path. Wait for precaching to finish before cutting the network, and wait for the persister's 250ms throttled write before navigating away or the previous list's items never make it to localStorage.
- Frontend tests: Node's experimental `localStorage` global shadows jsdom's, so `src/test/setup.ts` installs an in-memory Storage and clears it (plus `onlineManager`) between tests. MSW handlers live in `src/test/server.ts`.
