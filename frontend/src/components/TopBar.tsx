import { useState, useSyncExternalStore } from 'react'
import AppBar from '@mui/material/AppBar'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckIcon from '@mui/icons-material/Check'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  getCachedItems,
  useAddList,
  useClearChecked,
  useDeleteList,
  useLists,
  useRenameList,
} from '../api/hooks'
import ListNameDialog from './ListNameDialog'

export default function TopBar({ listId }: { listId: string }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: lists } = useLists()
  const clearChecked = useClearChecked()
  const addList = useAddList()
  const renameList = useRenameList()
  const deleteList = useDeleteList()

  const [listMenuAnchor, setListMenuAnchor] = useState<HTMLElement | null>(null)
  const [overflowAnchor, setOverflowAnchor] = useState<HTMLElement | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [newListOpen, setNewListOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isOnline = useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  )

  const currentList = lists?.find((l) => l.id === listId)
  const onlyOneList = (lists?.length ?? 0) <= 1

  const switchTo = (id: string) => {
    setListMenuAnchor(null)
    if (id !== listId) navigate(`/l/${id}`)
  }

  const createList = (name: string) => {
    const id = addList.mutate(name)
    navigate(`/l/${id}`)
  }

  const confirmDelete = () => {
    setDeleteOpen(false)
    // Navigate to a surviving list first, then delete — navigation must not
    // live in a mutation callback (offline resume re-runs only the default).
    const fallback = lists?.find((l) => l.id !== listId)
    if (!fallback) return
    navigate(`/l/${fallback.id}`, { replace: true })
    deleteList.mutate({ id: listId })
  }

  const itemCount = getCachedItems(client, listId).length

  return (
    <AppBar position="sticky">
      <Toolbar>
        <Button
          color="inherit"
          endIcon={<ArrowDropDownIcon />}
          onClick={(e) => setListMenuAnchor(e.currentTarget)}
          sx={{ flexGrow: 1, justifyContent: 'flex-start', textTransform: 'none' }}
        >
          <span style={{ fontSize: '1.25rem', fontWeight: 500 }}>
            {currentList?.name ?? 'AisleFlow'}
          </span>
        </Button>

        <Menu
          anchorEl={listMenuAnchor}
          open={!!listMenuAnchor}
          onClose={() => setListMenuAnchor(null)}
        >
          {(lists ?? []).map((l) => (
            <MenuItem
              key={l.id}
              selected={l.id === listId}
              onClick={() => switchTo(l.id)}
            >
              {l.id === listId ? (
                <CheckIcon fontSize="small" sx={{ mr: 1 }} />
              ) : (
                <span style={{ display: 'inline-block', width: 20, marginRight: 8 }} />
              )}
              <ListItemText>{l.name}</ListItemText>
            </MenuItem>
          ))}
          <Divider />
          <MenuItem
            onClick={() => {
              setListMenuAnchor(null)
              setNewListOpen(true)
            }}
          >
            New list…
          </MenuItem>
        </Menu>

        {!isOnline && (
          <Chip size="small" label="Offline" color="warning" sx={{ mr: 1 }} />
        )}
        <IconButton
          color="inherit"
          aria-label="More options"
          onClick={(e) => setOverflowAnchor(e.currentTarget)}
        >
          <MoreVertIcon />
        </IconButton>
        <Menu
          anchorEl={overflowAnchor}
          open={!!overflowAnchor}
          onClose={() => setOverflowAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setOverflowAnchor(null)
              setRenameOpen(true)
            }}
          >
            Rename list…
          </MenuItem>
          <MenuItem
            disabled={onlyOneList}
            onClick={() => {
              setOverflowAnchor(null)
              setDeleteOpen(true)
            }}
          >
            Delete list…
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              setOverflowAnchor(null)
              setClearOpen(true)
            }}
          >
            Clear checked…
          </MenuItem>
        </Menu>

        <Dialog open={clearOpen} onClose={() => setClearOpen(false)}>
          <DialogTitle>Clear checked items?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              All checked items will be removed from the list permanently.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button
              color="error"
              onClick={() => {
                setClearOpen(false)
                clearChecked.mutate({ listId })
              }}
            >
              Clear
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
          <DialogTitle>Delete “{currentList?.name}”?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This list and its {itemCount} item{itemCount === 1 ? '' : 's'} will
              be removed permanently.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button color="error" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        <ListNameDialog
          open={newListOpen}
          title="New list"
          submitLabel="Create"
          onSubmit={createList}
          onClose={() => setNewListOpen(false)}
        />
        <ListNameDialog
          open={renameOpen}
          title="Rename list"
          submitLabel="Rename"
          initialName={currentList?.name}
          onSubmit={(name) => renameList.mutate({ id: listId, name })}
          onClose={() => setRenameOpen(false)}
        />
      </Toolbar>
    </AppBar>
  )
}
