import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import CssBaseline from '@mui/material/CssBaseline'
import Snackbar from '@mui/material/Snackbar'
import { ThemeProvider } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { onAppError } from './api/notify'
import { createAppQueryClient, ITEMS_KEY } from './api/queryClient'
import { buildTheme } from './theme'
import AddItemBar from './components/AddItemBar'
import ShoppingList from './components/ShoppingList'
import TopBar from './components/TopBar'

const FLASH_DURATION_MS = 2000

function AppContent() {
  const [error, setError] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => onAppError(setError), [])

  const flash = (id: string) => {
    clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = setTimeout(() => setFlashId(null), FLASH_DURATION_MS)
  }

  return (
    <>
      <TopBar />
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 600, pb: 8 }}>
        <AddItemBar onDuplicate={flash} />
        <ShoppingList flashId={flashId} />
      </Container>
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
    </>
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
          buster: 'v1',
        }}
        onSuccess={() =>
          queryClient
            .resumePausedMutations()
            .then(() => queryClient.invalidateQueries({ queryKey: ITEMS_KEY }))
        }
      >
        <AppContent />
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
