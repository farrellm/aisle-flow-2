# AisleFlow

A shared shopping list web app for a household. Several named lists (Groceries,
Hardware, …), no accounts, no login — anyone who can reach the app can edit any
list. Built to be used in a grocery store, which means it has to work when the
phone doesn't: it installs as a PWA, renders the last-known list with no
connection, and queues edits made offline for replay on reconnect.

**[DESIGN.md](DESIGN.md) is the authoritative design document.** This README is
the short version; anything that looks arbitrary in the code is usually
explained there, and code comments cite its sections by number.

## What it does

- **Unchecked items on top, checked below.** Unchecked items are ordered
  manually by drag and drop; checked items sort alphabetically.
- **Order is preserved across checking.** Checking an item and later unchecking
  it returns it to exactly the position it had. This is the point of the app,
  and it is why checking never touches an item's `position` (§3).
- **Add converges instead of duplicating.** Re-adding a name that is already on
  the list unchecks the existing (checked) row rather than creating a second
  one, so it reappears at its preserved spot.
- **Multiple lists**, each fully independent — ordering, dedup, and offline
  behavior are all scoped per list. The current list lives in the URL,
  `/l/{listId}`.
- **Offline-tolerant** (§13): cached shell + data, optimistic writes queued in
  localStorage, drained FIFO when the network comes back.
- Changes propagate between devices by polling every few seconds. No WebSockets.

## Stack

Go (stdlib `net/http`) · PostgreSQL 16 in Docker · React 19 + Vite +
TypeScript + MUI, with TanStack Query, react-router, and dnd-kit.

In production it's a single Go binary with the built frontend embedded.

## Getting started

Requires Docker (with the `compose` plugin), Go 1.26+, and Node 22+.

```bash
make dev      # start the db, apply migrations, run backend + frontend
```

Then open **http://localhost:5174**.

`make dev` is the cold-start path. Once the database container is up — it
usually stays up — the faster loop is:

```bash
make -j2 backend frontend
```

### Ports

| Port | What |
|---|---|
| 5174 | Vite dev server (proxies `/api` → 8081) |
| 8081 | Go backend (dev) |
| 5434 | PostgreSQL (Docker container `aisleflow-db`) |
| 8082 | e2e suite's production binary (own `aisleflow_e2e` database) |
| 8090 | deployed instance, loopback only (see [Deployment](#deployment)) |

These are deliberately off the defaults so the project can coexist with others
on the same machine.

## Commands

```bash
make dev                  # cold start: db + migrate + backend + frontend
make -j2 backend frontend # db already running (the usual case)
make test                 # go test ./... + vitest (backend tests need the db)
make e2e                  # offline/PWA Playwright suite (prod build, own db)
make build                # vite build → embed in Go binary → backend/server

make db-create            # start the db container and wait for its healthcheck
make db-migrate           # apply pending migrations (golang-migrate, dockerized)
make db-stop              # stop the container
make db-destroy           # down -v: delete the container *and its data*

cd frontend && npm run lint   # oxlint
cd frontend && npx tsc -b     # typecheck
```

The service worker is disabled in dev, so none of the offline behavior can be
exercised against the Vite dev server — use `make e2e`, or `make build` and run
`./backend/server` directly.

## Layout

```
aisle-flow/
├─ DESIGN.md              authoritative design doc
├─ CLAUDE.md              working notes / invariants for editing this repo
├─ Makefile
├─ docker-compose.yml
├─ db/migrations/         golang-migrate SQL pairs, applied by `make db-migrate`
├─ backend/
│  ├─ cmd/server/
│  └─ internal/
│     ├─ api/             HTTP layer: ServeMux router, handlers, error envelope
│     ├─ store/           all SQL, plus the position algorithm (§3)
│     ├─ testdb/          test-database helper (applies every migration)
│     └─ webui/           embedded production frontend (build tag `embedui`)
└─ frontend/
   ├─ e2e/                Playwright offline/PWA suite
   └─ src/
      ├─ api/             fetch client, QueryClient + mutation defaults, hooks
      ├─ components/
      └─ test/            vitest + MSW
```

Two structural rules worth knowing before editing: **all** SQL and position
math lives in `store/` (handlers never compute a position), and **all** mutation
logic lives in `frontend/src/api/queryClient.ts` as keyed mutation defaults —
only defaults registered by key survive being dehydrated to localStorage and
resumed after a reload, so an offline-queued mutation with its logic inline in a
component would silently not replay.

## API

JSON over HTTP under `/api`, no auth. Items are nested under their list; an item
addressed through the wrong list's prefix is a 404.

```
GET    /api/lists
POST   /api/lists                         { name, id? }
PATCH  /api/lists/{listId}                { name }
DELETE /api/lists/{listId}                          (409 if it's the last list)

GET    /api/lists/{listId}/items
POST   /api/lists/{listId}/items          { name, id? }      create-or-revive
PATCH  /api/lists/{listId}/items/{id}     { name?, checked?, before?, after? }
DELETE /api/lists/{listId}/items/{id}

GET    /api/healthz
```

Errors use a uniform envelope, `{"error": {"code", "message"}}`. Reorder
requests name the neighboring item ids (`before`/`after`) rather than a
position — the server computes positions. Ids may be client-generated and sent
on create, which is what lets an offline *add → check* chain reference an item
before the server has ever seen it. Full specification in §6.

## Deployment

Household-scale: the same binary on a machine on the tailnet, reachable only
over Tailscale. No public exposure, no cloud bill, and no auth to invent for an
app that deliberately has none.

A **systemd user unit** (`~/.config/systemd/user/aisleflow.service`) owns the
lifecycle: it starts the Postgres container, runs `backend/server` bound to
`127.0.0.1:8090`, and publishes it with `tailscale serve --https=8443`. Run
`tailscale serve status` for the URL.

```bash
make build && systemctl --user restart aisleflow   # deploy
journalctl --user -u aisleflow -f                  # logs
```

Two things are required for it to survive a reboot, and both are easy to miss:
`sudo loginctl enable-linger <user>` (or the user manager only starts at login),
and HTTPS enabled for the tailnet in the Tailscale admin console (or
`tailscale serve --https` can't get a certificate). The unit deliberately has no
`After=docker.service` — a user manager can't order against system units — so it
handles the boot race against `dockerd` by failing and retrying forever instead.
See §9 for why the port is 8443 and not 443.

## Not in scope

No accounts or authentication, no real-time push, and no item metadata beyond a
name — no quantities, categories, or notes. Concurrency is last-write-wins
throughout, with no version guards; the accepted trade-offs are enumerated at
the end of §13. §12 lists what a future version might add.
