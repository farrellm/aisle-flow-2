import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import List from '@mui/material/List'
import { useQueryClient } from '@tanstack/react-query'
import { setDragging } from '../api/notify'
import { useUpdateItem } from '../api/hooks'
import { applyReorderOptimistic } from '../api/queryClient'
import { planReorder } from '../api/reorder'
import type { Item } from '../api/types'
import ItemRow from './ItemRow'

interface UncheckedListProps {
  items: Item[] // already sorted by position
  flashId: string | null
  onToggle: (item: Item) => void
  onDelete: (item: Item) => void
}

export default function UncheckedList({ items, flashId, onToggle, onDelete }: UncheckedListProps) {
  const updateItem = useUpdateItem()
  const client = useQueryClient()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    if (!over) return
    const moved = items.find((i) => i.id === String(active.id))
    if (!moved) return
    const plan = planReorder(items, moved.id, String(over.id))
    if (!plan) return
    // Write the reordered position to the cache synchronously so the list
    // re-renders in the same commit as dnd-kit's drag-transform reset (the
    // query client flushes notifications synchronously — see queryClient.ts —
    // so no flushSync is needed here).
    applyReorderOptimistic(client, moved.listId, moved.id, plan.position)
    updateItem.mutate({
      listId: moved.listId,
      id: moved.id,
      patch: plan.patch,
      optimistic: { position: plan.position },
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <List disablePadding>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              sortable
              flash={item.id === flashId}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </List>
      </SortableContext>
    </DndContext>
  )
}
