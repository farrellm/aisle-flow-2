import { createTheme } from '@mui/material/styles'

export const buildTheme = (prefersDark: boolean) =>
  createTheme({
    palette: {
      mode: prefersDark ? 'dark' : 'light',
    },
  })
