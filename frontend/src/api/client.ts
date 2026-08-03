import { onlineManager } from '@tanstack/react-query'
import type { Item, ListInfo, UpdatePatch } from './types'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// A request that never reached the server, as opposed to a server that
// answered with an error. The distinction drives the replay policy (§13): an
// ApiError is the server's verdict and the mutation drops out of the queue; a
// NetworkError means we simply could not ask, so the mutation must stay queued.
export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('network unreachable', options)
    this.name = 'NetworkError'
  }
}

// Matches the query poll (§4), so recovery feels the same however it arrives.
const PROBE_INTERVAL_MS = 4000
let probeTimer: ReturnType<typeof setInterval> | undefined

function stopProbe() {
  if (probeTimer === undefined) return
  clearInterval(probeTimer)
  probeTimer = undefined
}

// Any route back online — including the browser's own `online` event — retires
// the probe.
onlineManager.subscribe((online) => {
  if (online) stopProbe()
})

/**
 * A dead uplink (captive portal, one bar of signal, a router that answers DHCP
 * and nothing else) leaves `navigator.onLine` true while every request fails.
 * Left alone, mutations fire, exhaust their retries and roll back — silently
 * dropping the user's edit, which is the one thing the offline design exists to
 * prevent. Treat "unreachable" as offline so the queue holds the write (§13).
 *
 * Recovery has to be probed for: the browser never believed we were offline, so
 * it will not fire an `online` event. The probe hits `/api/healthz`
 * deliberately — the service worker's runtime cache covers the list and items
 * GETs, so probing those could be answered out of cache while the network is
 * still dead.
 */
function markOffline() {
  onlineManager.setOnline(false)
  if (probeTimer !== undefined) return
  probeTimer = setInterval(async () => {
    try {
      if (!(await fetch('/api/healthz', { cache: 'no-store' })).ok) return
    } catch {
      return
    }
    stopProbe()
    onlineManager.setOnline(true)
  }, PROBE_INTERVAL_MS)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch (cause) {
    markOffline()
    throw new NetworkError({ cause })
  }
  if (!res.ok) {
    let code = 'internal'
    let message = `request failed (${res.status})`
    try {
      const body = await res.json()
      code = body.error.code
      message = body.error.message
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  listLists: () => request<{ lists: ListInfo[] }>('/api/lists'),
  // The client supplies list/item ids so mutations queued offline behind a
  // create can reference the new row before the response arrives (§13).
  addList: (name: string, id?: string) =>
    request<{ list: ListInfo }>('/api/lists', {
      method: 'POST',
      body: JSON.stringify(id ? { id, name } : { name }),
    }),
  renameList: (id: string, name: string) =>
    request<{ list: ListInfo }>(`/api/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteList: (id: string) =>
    request<void>(`/api/lists/${id}`, { method: 'DELETE' }),
  listItems: (listId: string) =>
    request<{ items: Item[] }>(`/api/lists/${listId}/items`),
  addItem: (listId: string, name: string, id?: string) =>
    request<{ item: Item; revived: boolean }>(`/api/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(id ? { id, name } : { name }),
    }),
  updateItem: (listId: string, id: string, patch: UpdatePatch) =>
    request<{ item: Item }>(`/api/lists/${listId}/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteItem: (listId: string, id: string) =>
    request<void>(`/api/lists/${listId}/items/${id}`, { method: 'DELETE' }),
}
