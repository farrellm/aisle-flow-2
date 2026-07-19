import { useEffect, useRef, useState } from 'react'
import Container from '@mui/material/Container'
import { useNavigate, useParams } from 'react-router-dom'
import { useLists } from '../api/hooks'
import { notifyAppError } from '../api/notify'
import AddItemBar from './AddItemBar'
import ShoppingList from './ShoppingList'
import TopBar from './TopBar'

// localStorage key remembering the last-viewed list for RootRedirect.
export const LAST_LIST_KEY = 'aisleflow-last-list'

const FLASH_DURATION_MS = 2000

export default function ListScreen() {
  const { listId = '' } = useParams()
  const navigate = useNavigate()
  const { data: lists } = useLists()

  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const flash = (id: string) => {
    clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = setTimeout(() => setFlashId(null), FLASH_DURATION_MS)
  }

  useEffect(() => {
    localStorage.setItem(LAST_LIST_KEY, listId)
  }, [listId])

  // A deleted or unknown list — loaded but absent from the lists — bounces
  // back to RootRedirect (§7). `lists` undefined means the request hasn't
  // resolved (or failed offline with nothing cached); stay put. The redirect
  // is debounced so a just-created list, navigated to before its optimistic
  // cache entry lands, isn't briefly mistaken for missing.
  const missing = lists !== undefined && !lists.some((l) => l.id === listId)
  useEffect(() => {
    if (!missing) return
    const timer = setTimeout(() => {
      notifyAppError('List not found')
      navigate('/', { replace: true })
    }, 250)
    return () => clearTimeout(timer)
  }, [missing, navigate])

  return (
    <>
      <TopBar listId={listId} />
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 600, pb: 8 }}>
        <AddItemBar listId={listId} onDuplicate={flash} />
        <ShoppingList listId={listId} flashId={flashId} />
      </Container>
    </>
  )
}
