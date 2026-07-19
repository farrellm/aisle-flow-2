import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { Navigate } from 'react-router-dom'
import { useLists } from '../api/hooks'
import { LAST_LIST_KEY } from './ListScreen'

// The unmatched-path route (§7): forwards to the last-viewed list if it
// still exists, else the first list.
export default function RootRedirect() {
  const { data: lists, isPending } = useLists()

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (!lists || lists.length === 0) {
    // The server guards the last list, so this means the lists request
    // failed with nothing cached (e.g. first visit while offline).
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography color="text.secondary">
          Couldn't load your lists — check your connection and reload.
        </Typography>
      </Box>
    )
  }

  const last = localStorage.getItem(LAST_LIST_KEY)
  const target = lists.find((l) => l.id === last) ?? lists[0]
  return <Navigate replace to={`/l/${target.id}`} />
}
