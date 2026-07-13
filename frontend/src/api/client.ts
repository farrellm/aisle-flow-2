import type { Item, UpdatePatch } from './types'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
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
  listItems: () => request<{ items: Item[] }>('/api/items'),
  // The client supplies the id so mutations queued offline behind the
  // create can reference the item before the response arrives.
  addItem: (name: string, id?: string) =>
    request<{ item: Item; revived: boolean }>('/api/items', {
      method: 'POST',
      body: JSON.stringify(id ? { id, name } : { name }),
    }),
  updateItem: (id: string, patch: UpdatePatch) =>
    request<{ item: Item }>(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteItem: (id: string) =>
    request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  clearChecked: () =>
    request<{ deleted: number }>('/api/items?checked=true', { method: 'DELETE' }),
}
