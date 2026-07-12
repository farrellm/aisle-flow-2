import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { isDragging, notifyAppError } from './notify'
import { maxPosition } from './sort'
import type { Item, UpdatePatch } from './types'

const ITEMS_KEY = ['items'] as const

export function useItems() {
  const client = useQueryClient()
  return useQuery({
    queryKey: ITEMS_KEY,
    queryFn: async () => (await api.listItems()).items,
    refetchInterval: () =>
      isDragging() || client.isMutating() > 0 ? false : 4000,
    refetchOnWindowFocus: true,
  })
}

// Shared optimistic-update plumbing (§7): cancel in-flight queries, patch the
// cache, roll back on error + Snackbar, invalidate on settle to reconcile
// with the server (picking up the server-computed position).
function useOptimisticMutation<TVars, TData>(opts: {
  mutationFn: (vars: TVars) => Promise<TData>
  patch: (items: Item[], vars: TVars) => Item[]
  onSuccess?: (data: TData, vars: TVars) => void
}) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: opts.mutationFn,
    onMutate: async (vars: TVars) => {
      await client.cancelQueries({ queryKey: ITEMS_KEY })
      const previous = client.getQueryData<Item[]>(ITEMS_KEY)
      client.setQueryData<Item[]>(ITEMS_KEY, (items = []) =>
        opts.patch(items, vars),
      )
      return { previous }
    },
    onSuccess: opts.onSuccess,
    onError: (err, _vars, context) => {
      if (context?.previous) client.setQueryData(ITEMS_KEY, context.previous)
      notifyAppError(err.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: ITEMS_KEY }),
  })
}

export function useAddItem() {
  return useOptimisticMutation({
    mutationFn: (name: string) => api.addItem(name),
    patch: (items, name) => {
      const existing = items.find(
        (i) => i.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
      )
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
          id: `optimistic-${Date.now()}`,
          name,
          checked: false,
          position: maxPosition(items) + 1024,
          createdAt: now,
          updatedAt: now,
        },
      ]
    },
  })
}

export interface UpdateVars {
  id: string
  patch: UpdatePatch
  // Optimistic view of the change; for reorders this carries the locally
  // computed midpoint position until the server's value arrives.
  optimistic: Partial<Item>
}

export function useUpdateItem() {
  return useOptimisticMutation({
    mutationFn: ({ id, patch }: UpdateVars) => api.updateItem(id, patch),
    patch: (items, { id, optimistic }) =>
      items.map((i) => (i.id === id ? { ...i, ...optimistic } : i)),
  })
}

export function useDeleteItem() {
  return useOptimisticMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    patch: (items, id) => items.filter((i) => i.id !== id),
  })
}

export function useClearChecked() {
  return useOptimisticMutation({
    mutationFn: (_vars: void) => api.clearChecked(),
    patch: (items) => items.filter((i) => !i.checked),
  })
}

export function getCachedItems(client: QueryClient): Item[] {
  return client.getQueryData<Item[]>(ITEMS_KEY) ?? []
}
