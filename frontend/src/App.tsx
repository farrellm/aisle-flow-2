import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'
import CssBaseline from '@mui/material/CssBaseline'
import Snackbar from '@mui/material/Snackbar'
import { ThemeProvider } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { onAppError } from './api/notify'
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
  const [queryClient] = useState(() => new QueryClient())

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
