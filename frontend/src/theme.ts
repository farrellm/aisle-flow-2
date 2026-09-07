import { createTheme } from '@mui/material/styles'

// A note is marginalia — something written in the margin of the list rather
// than another line to tick (§7). It gets its own palette entry because the
// existing roles are all spoken for: error.main is the delete swipe, and the
// duplicate-add flash already spends amber. Slate reads as ballpoint ink,
// which is the point.
declare module '@mui/material/styles' {
  interface Palette {
    note: { main: string; contrastText: string; rule: string; ground: string }
  }
  interface PaletteOptions {
    note?: { main: string; contrastText: string; rule: string; ground: string }
  }
}

export const buildTheme = (prefersDark: boolean) =>
  createTheme({
    palette: {
      mode: prefersDark ? 'dark' : 'light',
      note: {
        main: '#3F5B78',
        contrastText: '#FFFFFF',
        // The margin rule needs to read against the row's own ground, so it
        // lightens in dark mode rather than staying the backdrop's slate.
        rule: prefersDark ? '#7C9CBF' : '#3F5B78',
        // One step off background.paper — a tint, never a card.
        ground: prefersDark ? '#1B2430' : '#EDF1F5',
      },
    },
  })
