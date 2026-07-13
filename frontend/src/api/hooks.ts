import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { isDragging } from './notify'
import { ITEMS_KEY, type AddVars, type UpdateVars } from './queryClient'
import type { Item } from './types'

export type { UpdateVars } from './queryClient'

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

// The mutation hooks bind by key only: mutationFns and the optimistic
// cache plumbing live in the defaults registered by createAppQueryClient,
// so mutations queued offline can be dehydrated and resumed after a reload.

export function useAddItem() {
  const m = useMutation<{ item: Item; revived: boolean }, Error, AddVars>({
    mutationKey: ['addItem'],
  })
  return {
    ...m,
    mutate: (name: string) => m.mutate({ id: crypto.randomUUID(), name }),
  }
}

export function useUpdateItem() {
  return useMutation<{ item: Item }, Error, UpdateVars>({
    mutationKey: ['updateItem'],
  })
}

export function useDeleteItem() {
  return useMutation<void, Error, string>({ mutationKey: ['deleteItem'] })
}

export function useClearChecked() {
  return useMutation<{ deleted: number }, Error, void>({
    mutationKey: ['clearChecked'],
  })
}

export function getCachedItems(client: QueryClient): Item[] {
  return client.getQueryData<Item[]>(ITEMS_KEY) ?? []
}
