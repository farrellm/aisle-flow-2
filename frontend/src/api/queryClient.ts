import { notifyManager, QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import { notifyAppError } from './notify'
import { findByName, maxPosition } from './sort'
import type { Item, ListInfo, UpdatePatch } from './types'

export const LISTS_KEY = ['lists'] as const
export const itemsKey = (listId: string) => ['items', listId] as const

// Flush query-cache change notifications synchronously instead of on TanStack's
// default setTimeout(0) macrotask. An optimistic cache write made inside a DOM
// event handler (the drag-drop reorder) must re-render the list in the *same*
// commit as dnd-kit's synchronous drag-transform reset; the default scheduler
// defers the re-render to a later macrotask (after paint), so the row renders
// at its old slot for a few frames first — the drop flicker. Synchronous
// scheduling lets React batch the cache-driven re-render with the drop.
notifyManager.setScheduler((cb) => cb())

// Synchronous optimistic reorder: mirror the ['updateItem'] onMutate position
// write into the cache from within the drop's event handler so the new order
// commits in the same React frame that dnd-kit clears its drag transform.
// Deferring it to the mutation lifecycle (a later microtask) leaves the row at
// its old slot for a frame first — the visible "jump" (§3/§7). Persistence
// still flows through the ['updateItem'] mutation; its onMutate re-applies the
// same position idempotently and owns offline-resume.
export function applyReorderOptimistic(
  client: QueryClient,
  listId: string,
  id: string,
  position: number,
) {
  const key = itemsKey(listId)
  // Abort any in-flight items poll *synchronously*, here at drop time, before
  // writing the optimistic order. A background poll (started up to a refetch
  // interval earlier, so carrying the pre-drop order) can otherwise resolve in
  // the gap between this write and the mutation's own cancelQueries in
  // onMutate, landing its stale result on top of the new order for a frame —
  // an intermittent flash of the original order after a drop. The mutation's
  // onSettled invalidate still refetches the server-authoritative order after.
  // { revert: false }: keep this optimistic write, don't roll back to the
  // aborted poll's pre-fetch snapshot.
  client.cancelQueries({ queryKey: key }, { revert: false })
  client.setQueryData<Item[]>(key, (items = []) =>
    items.map((i) => (i.id === id ? { ...i, position } : i)),
  )
}

// Every item-mutation vars object carries listId: vars are what the
// persister serializes, so a mutation resumed after a reload must be able to
// re-derive its query key and URL from them alone (§13).
export interface AddVars {
  listId: string
  id: string
  name: string
}

export interface UpdateVars {
  listId: string
  id: string
  patch: UpdatePatch
  // Optimistic view of the change; for reorders this carries the locally
  // computed midpoint position until the server's value arrives.
  optimistic: Partial<Item>
}

export interface DeleteVars {
  listId: string
  id: string
}

export interface ClearVars {
  listId: string
}

export interface AddListVars {
  id: string
  name: string
}

export interface RenameListVars {
  id: string
  name: string
}

export interface DeleteListVars {
  id: string
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
        // Serialize list and item mutations in one queue so an offline
        // create-list → add → check chain replays in order.
        scope: { id: 'items' },
      },
    },
  })

  // Shared optimistic-update plumbing (§7): cancel in-flight queries, patch
  // the cache, roll back on error + Snackbar, invalidate on settle to
  // reconcile with the server (picking up the server-computed position).
  // The target list's key is re-derived from vars each time — after a reload
  // the onMutate context is gone; the persisted cache already holds the
  // optimistic state, so the invalidate alone reconciles.
  const optimistic = <TVars extends { listId: string }>(
    patch: (items: Item[], vars: TVars) => Item[],
  ) => ({
    onMutate: async (vars: TVars) => {
      const key = itemsKey(vars.listId)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Item[]>(key)
      client.setQueryData<Item[]>(key, (items = []) => patch(items, vars))
      return { previous }
    },
    onError: (err: Error, vars: TVars, context?: { previous?: Item[] }) => {
      if (context?.previous)
        client.setQueryData(itemsKey(vars.listId), context.previous)
      notifyAppError(err.message)
    },
    onSettled: (_data: unknown, _error: unknown, vars: TVars) =>
      client.invalidateQueries({ queryKey: itemsKey(vars.listId) }),
  })

  // Same plumbing for the lists collection itself.
  const optimisticLists = <TVars>(
    patch: (lists: ListInfo[], vars: TVars) => ListInfo[],
  ) => ({
    onMutate: async (vars: TVars) => {
      await client.cancelQueries({ queryKey: LISTS_KEY })
      const previous = client.getQueryData<ListInfo[]>(LISTS_KEY)
      client.setQueryData<ListInfo[]>(LISTS_KEY, (lists = []) =>
        patch(lists, vars),
      )
      return { previous }
    },
    onError: (err: Error, _vars: TVars, context?: { previous?: ListInfo[] }) => {
      if (context?.previous) client.setQueryData(LISTS_KEY, context.previous)
      notifyAppError(err.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: LISTS_KEY }),
  })

  client.setMutationDefaults(['addItem'], {
    mutationFn: ({ listId, id, name }: AddVars) => api.addItem(listId, name, id),
    ...optimistic<AddVars>((items, { listId, id, name }) => {
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
          listId,
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
    mutationFn: ({ listId, id, patch }: UpdateVars) =>
      api.updateItem(listId, id, patch),
    ...optimistic<UpdateVars>((items, { id, optimistic: opt }) =>
      items.map((i) => (i.id === id ? { ...i, ...opt } : i)),
    ),
  })

  client.setMutationDefaults(['deleteItem'], {
    mutationFn: ({ listId, id }: DeleteVars) => api.deleteItem(listId, id),
    ...optimistic<DeleteVars>((items, { id }) =>
      items.filter((i) => i.id !== id),
    ),
  })

  client.setMutationDefaults(['clearChecked'], {
    mutationFn: ({ listId }: ClearVars) => api.clearChecked(listId),
    ...optimistic<ClearVars>((items) => items.filter((i) => !i.checked)),
  })

  client.setMutationDefaults(['addList'], {
    mutationFn: ({ id, name }: AddListVars) => api.addList(name, id),
    ...optimisticLists<AddListVars>((lists, { id, name }) => {
      const now = new Date().toISOString()
      return [...lists, { id, name, createdAt: now, updatedAt: now }]
    }),
  })

  client.setMutationDefaults(['renameList'], {
    mutationFn: ({ id, name }: RenameListVars) => api.renameList(id, name),
    ...optimisticLists<RenameListVars>((lists, { id, name }) =>
      lists.map((l) => (l.id === id ? { ...l, name } : l)),
    ),
  })

  const deleteListOptimistic = optimisticLists<DeleteListVars>(
    (lists, { id }) => lists.filter((l) => l.id !== id),
  )
  client.setMutationDefaults(['deleteList'], {
    mutationFn: ({ id }: DeleteListVars) => api.deleteList(id),
    ...deleteListOptimistic,
    onMutate: (vars: DeleteListVars) => {
      // Drop the doomed list's cached items so they can't linger in the
      // persisted cache after the delete lands.
      client.removeQueries({ queryKey: itemsKey(vars.id) })
      return deleteListOptimistic.onMutate(vars)
    },
  })

  return client
}
