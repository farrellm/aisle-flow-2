import { useRef, useState } from 'react'
import type React from 'react'

// Slop before a horizontal drag counts as a swipe, so checkbox taps and
// vertical scrolling are unaffected.
const ACTIVATION_SLOP_PX = 12
// Fraction of the row width the swipe must cross to commit its action.
const COMMIT_FRACTION = 0.4
// Width of the revealed action strip (exported so ItemRow sizes the buttons
// to match).
export const REVEAL_WIDTH_PX = 72

// Which action strip is currently exposed: 'left' is the one revealed by a
// right-to-left swipe (delete), 'right' the one revealed by a left-to-right
// swipe (make note). Only one can be open at a time.
export type SwipeSide = 'left' | 'right' | null

export interface SwipeState {
  // Current horizontal translation of the row content. Negative = swiped
  // left (delete), positive = swiped right (note).
  dx: number
  // True once a leftward swipe has committed and the row is sliding off.
  deleting: boolean
  swiping: boolean
  // Which side the row rests open on, if any.
  revealed: SwipeSide
  handlers: {
    onPointerDown: React.PointerEventHandler
    onPointerMove: React.PointerEventHandler
    onPointerUp: React.PointerEventHandler
    onPointerCancel: React.PointerEventHandler
    onClickCapture: React.MouseEventHandler
  }
}

interface RowSwipeOptions {
  // Right-to-left: destructive, so the row slides off-screen on commit.
  onSwipeLeft: () => void
  // Left-to-right: converts the row in place, so it springs back on commit.
  onSwipeRight: () => void
}

// Horizontal swipe on a row, both directions. Pointer Events, so it works for
// touch and mouse alike. The row content follows the finger; releasing past
// the commit threshold fires that direction's action, a shorter swipe snaps
// the row open to reveal that side's tappable button, and anything less
// springs back. One hook rather than two, because the two directions share
// pointer capture and click suppression over the same element.
export function useRowSwipe({ onSwipeLeft, onSwipeRight }: RowSwipeOptions): SwipeState {
  const [dx, setDx] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [swiping, setSwiping] = useState(false)
  const [revealed, setRevealed] = useState<SwipeSide>(null)
  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    baseDx: number
    active: boolean
    // Locked at activation so a gesture can't flip direction mid-swipe.
    direction: 1 | -1
  } | null>(null)
  // Survives gesture reset: the click event fires after pointerup.
  const suppressNextClick = useRef(false)

  const restDx = (side: SwipeSide) =>
    side === 'left' ? -REVEAL_WIDTH_PX : side === 'right' ? REVEAL_WIDTH_PX : 0

  const onPointerDown: React.PointerEventHandler = (e) => {
    if (deleting || (e.pointerType === 'mouse' && e.button !== 0)) return
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: restDx(revealed),
      active: false,
      direction: 1,
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
      g.direction = moveX < 0 ? -1 : 1
      suppressNextClick.current = true
      setSwiping(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    // Clamp to the locked direction's half of the axis, so an over-swipe back
    // past centre doesn't expose the opposite side's backdrop mid-gesture.
    const next = g.baseDx + moveX
    setDx(g.direction < 0 ? Math.min(0, next) : Math.max(0, next))
  }

  const finish: React.PointerEventHandler = (e) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.active) {
      gesture.current = null
      // A plain tap on the row content closes a revealed row without
      // toggling the checkbox underneath.
      if (revealed) {
        setRevealed(null)
        setDx(0)
        suppressNextClick.current = true
      }
      return
    }
    const width = e.currentTarget.getBoundingClientRect().width
    // How far the row travelled in the locked direction; positive = open.
    const offset = (g.baseDx + (e.clientX - g.startX)) * g.direction
    const direction = g.direction
    gesture.current = null
    setSwiping(false)
    if (e.type === 'pointercancel') {
      setDx(restDx(revealed))
    } else if (offset >= width * COMMIT_FRACTION) {
      setRevealed(null)
      if (direction < 0) {
        // Destructive: hold the row off-screen until it unmounts.
        setDeleting(true)
        setDx(-width)
        onSwipeLeft()
      } else {
        // The row is converted, not removed, so it springs back and
        // re-renders as a note (pinned to the top of the list).
        setDx(0)
        onSwipeRight()
      }
    } else if (offset >= REVEAL_WIDTH_PX / 2) {
      const side = direction < 0 ? 'left' : 'right'
      setRevealed(side)
      setDx(restDx(side))
    } else {
      setRevealed(null)
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
