import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { onlineManager } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'

registerSW({ immediate: true })

// onlineManager assumes online at startup and only reacts to window
// online/offline events; seed it so a page loaded while offline queues
// mutations instead of failing them.
onlineManager.setOnline(navigator.onLine)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
