import { useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'

interface ListNameDialogProps {
  open: boolean
  title: string
  submitLabel: string
  initialName?: string
  onSubmit: (name: string) => void
  onClose: () => void
}

// Shared name-entry dialog for creating and renaming lists (§7).
export default function ListNameDialog({
  open,
  title,
  submitLabel,
  initialName = '',
  onSubmit,
  onClose,
}: ListNameDialogProps) {
  const [name, setName] = useState(initialName)

  // Reset the field each time the dialog opens.
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label="List name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': 'List name' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
