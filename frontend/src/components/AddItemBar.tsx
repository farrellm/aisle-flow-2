import { useState } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import AddIcon from '@mui/icons-material/Add'
import { useQueryClient } from '@tanstack/react-query'
import { getCachedItems, useAddItem } from '../api/hooks'
import { findByName } from '../api/sort'

interface AddItemBarProps {
  // Fired when the typed name already exists unchecked: highlight that row
  // instead of duplicating (§2).
  onDuplicate: (id: string) => void
}

export default function AddItemBar({ onDuplicate }: AddItemBarProps) {
  const [text, setText] = useState('')
  const addItem = useAddItem()
  const client = useQueryClient()

  const submit = () => {
    const name = text.trim()
    if (!name) return
    setText('') // input clears and keeps focus so several items can be added in a row

    const existing = findByName(getCachedItems(client), name)
    if (existing && !existing.checked) {
      onDuplicate(existing.id)
      return
    }
    addItem.mutate(name)
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      sx={{ display: 'flex', gap: 1, px: 2, py: 1.5 }}
    >
      <TextField
        fullWidth
        size="small"
        placeholder="Add an item…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Add an item' } }}
      />
      <IconButton type="submit" color="primary" aria-label="Add">
        <AddIcon />
      </IconButton>
    </Box>
  )
}
