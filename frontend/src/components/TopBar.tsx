import { useState, useSyncExternalStore } from 'react'
import AppBar from '@mui/material/AppBar'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { onlineManager } from '@tanstack/react-query'
import { useClearChecked } from '../api/hooks'

export default function TopBar() {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const clearChecked = useClearChecked()
  const isOnline = useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  )

  return (
    <AppBar position="sticky">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          AisleFlow
        </Typography>
        {!isOnline && (
          <Chip size="small" label="Offline" color="warning" sx={{ mr: 1 }} />
        )}
        <IconButton
          color="inherit"
          aria-label="More options"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          <MoreVertIcon />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null)
              setConfirmOpen(true)
            }}
          >
            Clear checked…
          </MenuItem>
        </Menu>
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>Clear checked items?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              All checked items will be removed from the list permanently.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              color="error"
              onClick={() => {
                setConfirmOpen(false)
                clearChecked.mutate()
              }}
            >
              Clear
            </Button>
          </DialogActions>
        </Dialog>
      </Toolbar>
    </AppBar>
  )
}
