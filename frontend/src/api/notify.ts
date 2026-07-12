// Tiny pub-sub so the mutation layer can surface errors in the app-level
// Snackbar without threading a callback through every hook.

type Listener = (message: string) => void

let listener: Listener | null = null

export function onAppError(l: Listener): () => void {
  listener = l
  return () => {
    if (listener === l) listener = null
  }
}

export function notifyAppError(message: string) {
  listener?.(message)
}

// Polling is paused while a drag is in progress (§7) so a refetch can't
// yank rows mid-drag.
let dragging = false
export const setDragging = (v: boolean) => {
  dragging = v
}
export const isDragging = () => dragging
