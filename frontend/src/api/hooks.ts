import {
  onlineManager,
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
  type DeleteListVars,
  type DeleteVars,
  type RenameListVars,
  type UpdateVars,
} from './queryClient'
import type { Item, ListInfo } from './types'

export type { UpdateVars } from './queryClient'

// Offline, the only thing that can answer a GET is the service worker's copy of
// an older response (§13 Layer 1). That is never newer than the cache we
// restored from localStorage, and it is blind to optimistic writes still
// sitting in the queue — applying it would silently erase the user's unsent
// edits. So offline we fetch only to fill a gap (the cold-start case), never to
// replace data we already have. Recovery does not depend on polling: the
// browser's `online` event and the /api/healthz probe in client.ts both flip
// onlineManager, and refetchOnReconnect takes it from there.
const offlineSafeRefetch = {
  refetchOnMount: (query: { state: { data: unknown } }) =>
    onlineManager.isOnline() || query.state.data === undefined,
  refetchOnWindowFocus: () => onlineManager.isOnline(),
  refetchOnReconnect: true,
} as const

// A refetch mid-drag would yank rows out from under the pointer, and one
// mid-mutation would land pre-mutation data on top of the optimistic write.
const pollInterval = (client: QueryClient) => () =>
  !onlineManager.isOnline() || isDragging() || client.isMutating() > 0
    ? false
    : 4000

export function useLists() {
  const client = useQueryClient()
  return useQuery({
    queryKey: LISTS_KEY,
    queryFn: async () => (await api.listLists()).lists,
    refetchInterval: pollInterval(client),
    ...offlineSafeRefetch,
  })
}

export function useItems(listId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: itemsKey(listId),
    queryFn: async () => (await api.listItems(listId)).items,
    refetchInterval: pollInterval(client),
    ...offlineSafeRefetch,
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
