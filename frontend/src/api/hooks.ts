import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { isDragging } from './notify'
import {
  itemsKey,
  LISTS_KEY,
  type AddListVars,
  type AddVars,
  type ClearVars,
  type DeleteListVars,
  type DeleteVars,
  type RenameListVars,
  type UpdateVars,
} from './queryClient'
import type { Item, ListInfo } from './types'

export type { UpdateVars } from './queryClient'

export function useLists() {
  const client = useQueryClient()
  return useQuery({
    queryKey: LISTS_KEY,
    queryFn: async () => (await api.listLists()).lists,
    refetchInterval: () =>
      isDragging() || client.isMutating() > 0 ? false : 4000,
    refetchOnWindowFocus: true,
  })
}

export function useItems(listId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: itemsKey(listId),
    queryFn: async () => (await api.listItems(listId)).items,
    refetchInterval: () =>
      isDragging() || client.isMutating() > 0 ? false : 4000,
    refetchOnWindowFocus: true,
  })
}

// The mutation hooks bind by key only: mutationFns and the optimistic
// cache plumbing live in the defaults registered by createAppQueryClient,
// so mutations queued offline can be dehydrated and resumed after a reload.

export function useAddItem(listId: string) {
  const m = useMutation<{ item: Item; revived: boolean }, Error, AddVars>({
    mutationKey: ['addItem'],
  })
  return {
    ...m,
    mutate: (name: string) =>
      m.mutate({ listId, id: crypto.randomUUID(), name }),
  }
}

export function useUpdateItem() {
  return useMutation<{ item: Item }, Error, UpdateVars>({
    mutationKey: ['updateItem'],
  })
}

export function useDeleteItem() {
  return useMutation<void, Error, DeleteVars>({ mutationKey: ['deleteItem'] })
}

export function useClearChecked() {
  return useMutation<{ deleted: number }, Error, ClearVars>({
    mutationKey: ['clearChecked'],
  })
}

export function useAddList() {
  const m = useMutation<{ list: ListInfo }, Error, AddListVars>({
    mutationKey: ['addList'],
  })
  return {
    ...m,
    // Returns the client-generated id so the caller can navigate to the new
    // list immediately (navigation stays out of mutation callbacks, §13).
    mutate: (name: string) => {
      const id = crypto.randomUUID()
      m.mutate({ id, name })
      return id
    },
  }
}

export function useRenameList() {
  return useMutation<{ list: ListInfo }, Error, RenameListVars>({
    mutationKey: ['renameList'],
  })
}

export function useDeleteList() {
  return useMutation<void, Error, DeleteListVars>({
    mutationKey: ['deleteList'],
  })
}

export function getCachedItems(client: QueryClient, listId: string): Item[] {
  return client.getQueryData<Item[]>(itemsKey(listId)) ?? []
}
