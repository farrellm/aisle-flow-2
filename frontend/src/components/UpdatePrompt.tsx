import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Registers the service worker and offers the update rather than taking it
 * (§13). The worker is built in `prompt` mode, so a newly installed version
 * sits in `waiting` until `updateServiceWorker(true)` releases it — a deploy
 * cannot reload the page out from under a shopper with unsent mutations queued.
 *
 * Anchored top-center so it never lands on top of the error Snackbar.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  return (
    <Snackbar
      open={needRefresh}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        severity="info"
        onClose={() => setNeedRefresh(false)}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => updateServiceWorker(true)}
          >
            Reload
          </Button>
        }
      >
        A new version is available.
      </Alert>
    </Snackbar>
  )
}
