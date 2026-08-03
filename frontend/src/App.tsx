import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import CssBaseline from '@mui/material/CssBaseline'
import Snackbar from '@mui/material/Snackbar'
import { ThemeProvider } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { onlineManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { onAppError } from './api/notify'
import { createAppQueryClient, LISTS_KEY } from './api/queryClient'
import { buildTheme } from './theme'
import ListScreen from './components/ListScreen'
import RootRedirect from './components/RootRedirect'
import UpdatePrompt from './components/UpdatePrompt'

function ErrorSnackbar() {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => onAppError(setError), [])
  return (
    <Snackbar
      open={!!error}
      autoHideDuration={5000}
      onClose={() => setError(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity="error" onClose={() => setError(null)}>
        {error}
      </Alert>
    </Snackbar>
  )
}

export default function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const theme = useMemo(() => buildTheme(prefersDark), [prefersDark])
  const [queryClient] = useState(createAppQueryClient)
  // Persisting the query cache + paused mutations makes the last-known list
  // render offline and lets the offline mutation queue survive a reload.
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: window.localStorage,
      key: 'aisleflow-cache',
      // Default 1s throttle risks losing a just-queued mutation if the
      // tab closes right after a tap; the state is tiny, write sooner.
      throttleTime: 250,
    }),
  )

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 7 * 24 * 60 * 60 * 1000,
          // v3: "clear checked" removed — a queued ['clearChecked'] mutation
          // would resume with no registered default, rejecting
          // resumePausedMutations and skipping the post-restore invalidates.
          // Discarding the old cache once at upgrade avoids that (§13).
          buster: 'v3',
        }}
        // .finally, not .then: one rejected mutation in the resumed queue must
        // not swallow the reconciling invalidates (and leave an unhandled
        // rejection behind) for all the others.
        onSuccess={() =>
          queryClient.resumePausedMutations().finally(() => {
            // Reconciling with the server is pointless offline and actively
            // destructive: the only available answer is the service worker's
            // older cached copy, which would overwrite the optimistic state we
            // just restored — including writes still queued (§13). Coming back
            // online re-runs the queue, and each mutation's onSettled
            // invalidates then.
            if (!onlineManager.isOnline()) return
            queryClient.invalidateQueries({ queryKey: LISTS_KEY })
            // Prefix-matches every ['items', listId] query.
            queryClient.invalidateQueries({ queryKey: ['items'] })
          })
        }
      >
        <BrowserRouter>
          <Routes>
            <Route path="/l/:listId" element={<ListScreen />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
          <ErrorSnackbar />
          <UpdatePrompt />
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
