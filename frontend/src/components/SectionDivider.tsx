import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

export default function SectionDivider({ count }: { count: number }) {
  return (
    <Divider sx={{ my: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {count} in cart
      </Typography>
    </Divider>
  )
}
