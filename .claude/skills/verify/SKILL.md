---
name: verify
description: Build, launch, and drive AisleFlow to verify a change end-to-end in the running app.
---

# Verifying AisleFlow changes

## Launch

The dev DB usually stays up in Docker (`aisleflow-db`, port 5434). Check what's already running first:

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep aisleflow  # db
ss -tlnp | grep -E '5174|8081'                                # frontend / backend
```

- Full stack from cold: `make dev` (db + migrate + backend + frontend).
- DB already up: `make -j2 backend frontend` (run in background).
- Frontend: Vite on **http://localhost:5174** (not 5173 — that may be another project), proxies `/api` → backend on **8081**.
- Ready check: `curl -sf http://localhost:8081/api/items`.

## Drive

Use the Playwright MCP tools against http://localhost:5174.

- **The DB contains the user's real grocery list — never delete or toggle existing rows.** Add throwaway items (e.g. `ZZZ Verify A`) via the "Add an item…" textbox + "Add" button, and only gesture on those.
- Rows have `data-testid="item-row-<name>"`. Row width in the default viewport is ~600px.
- Swipe gestures are Pointer Events; Playwright `page.mouse` down/move/up works. Move in several steps (the hook needs >12px horizontal movement before it activates, and single large jumps work but stepped moves are more realistic).
- Swipe-to-delete thresholds: release ≥40% of row width → immediate delete; release ≥36px → snaps open revealing a `Delete <name>` button (out of the a11y tree while closed); less → springs back. Tap on row content closes a revealed row without toggling the checkbox.
- Screenshots via `browser_take_screenshot` **without** `filename` return the image inline; with a filename they land in the Playwright server's own directory, which is not on this filesystem.

## Gotchas

- Port 8080 and 5173 may belong to other projects on this machine — always use 5174/8081.
