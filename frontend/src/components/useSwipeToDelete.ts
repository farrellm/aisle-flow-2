import { useRef, useState } from 'react'
import type React from 'react'

// Slop before a horizontal drag counts as a swipe, so checkbox taps and
// vertical scrolling are unaffected.
const ACTIVATION_SLOP_PX = 12
// Fraction of the row width the swipe must cross to commit the delete.
const COMMIT_FRACTION = 0.4
// Width of the revealed Delete button strip (exported so ItemRow sizes the
// button to match).
export const REVEAL_WIDTH_PX = 72

export interface SwipeState {
  // Current leftward translation of the row content, <= 0.
  dx: number
  // True once the swipe has passed the commit threshold and the delete fired.
  deleting: boolean
  swiping: boolean
  // True while the row rests open with the Delete button exposed.
  revealed: boolean
  handlers: {
    onPointerDown: React.PointerEventHandler
    onPointerMove: React.PointerEventHandler
    onPointerUp: React.PointerEventHandler
    onPointerCancel: React.PointerEventHandler
    onClickCapture: React.MouseEventHandler
  }
}

// Swipe right-to-left to delete. Pointer Events, so it works for both touch
// and mouse. The row content follows the finger leftward; releasing past the
// commit threshold slides it off-screen and calls onDelete, a shorter swipe
// snaps the row open to reveal a tappable Delete button, and anything less
// springs back.
export function useSwipeToDelete(onDelete: () => void): SwipeState {
  const [dx, setDx] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [swiping, setSwiping] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    baseDx: number
    active: boolean
  } | null>(null)
  // Survives gesture reset: the click event fires after pointerup.
  const suppressNextClick = useRef(false)

  const onPointerDown: React.PointerEventHandler = (e) => {
    if (deleting || (e.pointerType === 'mouse' && e.button !== 0)) return
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: revealed ? -REVEAL_WIDTH_PX : 0,
      active: false,
    }
  }

  const onPointerMove: React.PointerEventHandler = (e) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId || deleting) return
    const moveX = e.clientX - g.startX
    const moveY = e.clientY - g.startY
    if (!g.active) {
      if (Math.abs(moveX) < ACTIVATION_SLOP_PX || Math.abs(moveX) < Math.abs(moveY)) {
        return
      }
      g.active = true
      suppressNextClick.current = true
      setSwiping(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDx(Math.min(0, g.baseDx + moveX)) // leftward only
  }

  const finish: React.PointerEventHandler = (e) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.active) {
      gesture.current = null
      // A plain tap on the row content closes a revealed row without
      // toggling the checkbox underneath.
      if (revealed) {
        setRevealed(false)
        setDx(0)
        suppressNextClick.current = true
      }
      return
    }
    const width = e.currentTarget.getBoundingClientRect().width
    // Final leftward offset of the row content; positive = open.
    const offset = g.baseDx - (e.clientX - g.startX)
    gesture.current = null
    setSwiping(false)
    if (e.type === 'pointercancel') {
      setDx(revealed ? -REVEAL_WIDTH_PX : 0)
    } else if (offset >= width * COMMIT_FRACTION) {
      setDeleting(true)
      setDx(-width)
      onDelete()
    } else if (offset >= REVEAL_WIDTH_PX / 2) {
      setRevealed(true)
      setDx(-REVEAL_WIDTH_PX)
    } else {
      setRevealed(false)
      setDx(0)
    }
  }

  // A pointerup that ends a swipe over the checkbox would otherwise toggle it.
  const onClickCapture: React.MouseEventHandler = (e) => {
    if (deleting || suppressNextClick.current) {
      e.preventDefault()
      e.stopPropagation()
      suppressNextClick.current = false
    }
  }

  return {
    dx,
    deleting,
    swiping,
    revealed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onClickCapture,
    },
  }
}
