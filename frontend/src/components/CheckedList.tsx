import List from '@mui/material/List'
import type { Item } from '../api/types'
import ItemRow from './ItemRow'

interface CheckedListProps {
  items: Item[] // already sorted alphabetically
  onToggle: (item: Item) => void
  onDelete: (item: Item) => void
}

export default function CheckedList({ items, onToggle, onDelete }: CheckedListProps) {
  return (
    <List disablePadding>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          sortable={false}
          flash={false}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </List>
  )
}
