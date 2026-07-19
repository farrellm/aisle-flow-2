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
  clearChecked: (listId: string) =>
    request<{ deleted: number }>(`/api/lists/${listId}/items?checked=true`, {
      method: 'DELETE',
    }),
}
