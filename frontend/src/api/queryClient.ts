import { QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import { notifyAppError } from './notify'
import { findByName, maxPosition } from './sort'
import type { Item, UpdatePatch } from './types'

export const ITEMS_KEY = ['items'] as const

export interface AddVars {
  id: string
  name: string
}

export interface UpdateVars {
  id: string
  patch: UpdatePatch
  // Optimistic view of the change; for reorders this carries the locally
  // computed midpoint position until the server's value arrives.
  optimistic: Partial<Item>
}

// All mutation logic lives in setMutationDefaults (keyed, not inline in
// hooks) so that mutations queued while offline survive a reload: the
// persister dehydrates paused mutations by key, and resumePausedMutations
// re-runs them through these defaults.
export function createAppQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Must outlive the persister's maxAge or restored queries are
        // garbage-collected before they can render.
        gcTime: 24 * 60 * 60 * 1000,
      },
      mutations: {
        // Network errors (fetch TypeError) retry; HTTP errors (ApiError,
        // e.g. a 404 for a reorder whose neighbor is gone) fail fast so a
        // stale queued mutation drops out and the refetch reconciles.
        retry: (failureCount, error) =>
          !(error instanceof ApiError) && failureCount < 3,
        // Serialize all item mutations so an offline create → check →
        // reorder chain replays in order.
        scope: { id: 'items' },
      },
    },
  })

  // Shared optimistic-update plumbing (§7): cancel in-flight queries, patch
  // the cache, roll back on error + Snackbar, invalidate on settle to
  // reconcile with the server (picking up the server-computed position).
  // After a reload the onMutate context is gone; the persisted cache already
  // holds the optimistic state, so the invalidate alone reconciles.
  const optimistic = <TVars>(patch: (items: Item[], vars: TVars) => Item[]) => ({
    onMutate: async (vars: TVars) => {
      await client.cancelQueries({ queryKey: ITEMS_KEY })
      const previous = client.getQueryData<Item[]>(ITEMS_KEY)
      client.setQueryData<Item[]>(ITEMS_KEY, (items = []) => patch(items, vars))
      return { previous }
    },
    onError: (err: Error, _vars: TVars, context?: { previous?: Item[] }) => {
      if (context?.previous) client.setQueryData(ITEMS_KEY, context.previous)
      notifyAppError(err.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: ITEMS_KEY }),
  })

  client.setMutationDefaults(['addItem'], {
    mutationFn: ({ id, name }: AddVars) => api.addItem(name, id),
    ...optimistic<AddVars>((items, { id, name }) => {
      const existing = findByName(items, name)
      if (existing) {
        // Revive: the server unchecks it; mirror that optimistically.
        return items.map((i) =>
          i.id === existing.id ? { ...i, checked: false } : i,
        )
      }
      const now = new Date().toISOString()
      return [
        ...items,
        {
          id,
          name,
          checked: false,
          position: maxPosition(items) + 1024,
          createdAt: now,
          updatedAt: now,
        },
      ]
    }),
  })

  client.setMutationDefaults(['updateItem'], {
    mutationFn: ({ id, patch }: UpdateVars) => api.updateItem(id, patch),
    ...optimistic<UpdateVars>((items, { id, optimistic: opt }) =>
      items.map((i) => (i.id === id ? { ...i, ...opt } : i)),
    ),
  })

  client.setMutationDefaults(['deleteItem'], {
    mutationFn: (id: string) => api.deleteItem(id),
    ...optimistic<string>((items, id) => items.filter((i) => i.id !== id)),
  })

  client.setMutationDefaults(['clearChecked'], {
    mutationFn: () => api.clearChecked(),
    ...optimistic<void>((items) => items.filter((i) => !i.checked)),
  })

  return client
}
