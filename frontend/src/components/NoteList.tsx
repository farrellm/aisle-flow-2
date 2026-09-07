import List from '@mui/material/List'
import type { Item } from '../api/types'
import ItemRow from './ItemRow'

interface NoteListProps {
  items: Item[] // already sorted by position
  flashId: string | null
  onToggle: (item: Item) => void
  onToggleNote: (item: Item) => void
  onDelete: (item: Item) => void
}

// Notes are pinned to the top of the list (§2), so they are not sortable and
// need no DndContext. They render in preserved position order, which keeps the
// relative order of several items converted one after another.
export default function NoteList({
  items,
  flashId,
  onToggle,
  onToggleNote,
  onDelete,
}: NoteListProps) {
  return (
    <List disablePadding>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          sortable={false}
          flash={item.id === flashId}
          onToggle={onToggle}
          onToggleNote={onToggleNote}
          onDelete={onDelete}
        />
      ))}
    </List>
  )
}
