import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import { useDeleteItem, useItems, useUpdateItem } from '../api/hooks'
import { splitItems } from '../api/sort'
import type { Item } from '../api/types'
import CheckedList from './CheckedList'
import UncheckedList from './UncheckedList'

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

export default function ShoppingList({ flashId }: { flashId: string | null }) {
  const { data: items, isPending } = useItems()
  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const { unchecked, checked } = splitItems(items ?? [])

  const handleToggle = (item: Item) =>
    updateItem.mutate({
      id: item.id,
      patch: { checked: !item.checked },
      optimistic: { checked: !item.checked },
    })

  const handleDelete = (item: Item) => deleteItem.mutate(item.id)

  if (unchecked.length === 0 && checked.length === 0) {
    return <CenteredNote>Your list is empty — add your first item above</CenteredNote>
  }

  return (
    <Box>
      {unchecked.length > 0 ? (
        <UncheckedList
          items={unchecked}
          flashId={flashId}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      ) : (
        <CenteredNote>All done! 🎉</CenteredNote>
      )}
      {checked.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <CheckedList items={checked} onToggle={handleToggle} onDelete={handleDelete} />
        </>
      )}
    </Box>
  )
}
