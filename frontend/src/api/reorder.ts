import { arrayMove } from '@dnd-kit/sortable'
import type { Item, UpdatePatch } from './types'

// Spacing constant mirrored from the backend's position algorithm (§3).
const POSITION_GAP = 1024

export interface ReorderPlan {
  patch: UpdatePatch
  // Local midpoint for the optimistic render; the server's value is
  // authoritative and arrives via the mutation response / refetch (§3).
  position: number
}

// Given the sorted unchecked items and a completed drag, name the neighbor
// ids at the drop location for the PATCH and compute the optimistic position.
export function planReorder(
  items: Item[],
  activeId: string,
  overId: string,
): ReorderPlan | null {
  const from = items.findIndex((i) => i.id === activeId)
  const to = items.findIndex((i) => i.id === overId)
  if (from < 0 || to < 0 || from === to) return null

  const reordered = arrayMove(items, from, to)
  const above = reordered[to - 1] // moved row lands after this one
  const below = reordered[to + 1] // and before this one

  let position: number
  if (above && below) {
    position = (above.position + below.position) / 2
  } else if (below) {
    position = below.position - POSITION_GAP
  } else if (above) {
    position = above.position + POSITION_GAP
  } else {
    position = items[from].position
  }

  return {
    patch: { after: above?.id ?? null, before: below?.id ?? null },
    position,
  }
}
