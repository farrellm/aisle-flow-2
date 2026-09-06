import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import { useDeleteItem, useItems, useUpdateItem } from '../api/hooks'
import { splitItems } from '../api/sort'
import type { Item } from '../api/types'
import CheckedList from './CheckedList'
import NoteList from './NoteList'
import UncheckedList from './UncheckedList'

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

interface ShoppingListProps {
  listId: string
  flashId: string | null
  onFlash: (id: string) => void
}

export default function ShoppingList({ listId, flashId, onFlash }: ShoppingListProps) {
  const { data: items, isPending } = useItems(listId)
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const { notes, unchecked, checked } = splitItems(items ?? [])

  const handleToggle = (item: Item) =>
    updateItem.mutate({
      listId: item.listId,
      id: item.id,
      patch: { checked: !item.checked },
      optimistic: { checked: !item.checked },
    })

  // Converting moves the row to (or away from) the top of the list, so flash
  // it at its new home — the same 2s pulse and scroll-into-view that marks a
  // duplicate add, so the eye can follow it. `position` is deliberately not
  // touched, which is what lets a note convert back into its old slot (§3).
  const handleToggleNote = (item: Item) => {
    const note = !item.note
    updateItem.mutate({
      listId: item.listId,
      id: item.id,
      patch: { note, checked: false },
      optimistic: { note, checked: false },
    })
    onFlash(item.id)
  }

  const handleDelete = (item: Item) =>
    deleteItem.mutate({ listId: item.listId, id: item.id })

  if (notes.length === 0 && unchecked.length === 0 && checked.length === 0) {
    return <CenteredNote>Your list is empty — add your first item above</CenteredNote>
  }

  return (
    <Box>
      {notes.length > 0 && (
        <>
          <NoteList
            items={notes}
            flashId={flashId}
            onToggle={handleToggle}
            onToggleNote={handleToggleNote}
            onDelete={handleDelete}
          />
          {(unchecked.length > 0 || checked.length > 0) && <Divider sx={{ my: 1 }} />}
        </>
      )}
      {unchecked.length > 0 ? (
        <UncheckedList
          items={unchecked}
          flashId={flashId}
          onToggle={handleToggle}
          onToggleNote={handleToggleNote}
          onDelete={handleDelete}
        />
      ) : (
        // A list holding nothing but notes isn't "all done" — nothing was
        // bought — so this only speaks up once something has been checked off.
        checked.length > 0 && <CenteredNote>All done! 🎉</CenteredNote>
      )}
      {checked.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <CheckedList
            items={checked}
            onToggle={handleToggle}
            onToggleNote={handleToggleNote}
            onDelete={handleDelete}
          />
        </>
      )}
    </Box>
  )
}
