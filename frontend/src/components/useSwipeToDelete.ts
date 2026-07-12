import { useRef, useState } from 'react'
import type React from 'react'

// Slop before a horizontal drag counts as a swipe, so checkbox taps and
// vertical scrolling are unaffected.
const ACTIVATION_SLOP_PX = 12
// Fraction of the row width the swipe must cross to commit the delete.
const COMMIT_FRACTION = 0.4

export interface SwipeState {
  // Current leftward translation of the row content, <= 0.
  dx: number
  // True once the swipe has passed the commit threshold and the delete fired.
  deleting: boolean
  swiping: boolean
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
// commit threshold slides it off-screen and calls onDelete, otherwise it
// springs back.
export function useSwipeToDelete(onDelete: () => void): SwipeState {
  const [dx, setDx] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [swiping, setSwiping] = useState(false)
  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  // Survives gesture reset: the click event fires after pointerup.
  const suppressNextClick = useRef(false)

  const reset = () => {
    gesture.current = null
    setSwiping(false)
    setDx(0)
  }

  const onPointerDown: React.PointerEventHandler = (e) => {
    if (deleting || (e.pointerType === 'mouse' && e.button !== 0)) return
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
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
    setDx(Math.min(0, moveX)) // leftward only
  }

  const finish: React.PointerEventHandler = (e) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.active) {
      gesture.current = null
      return
    }
    const width = e.currentTarget.getBoundingClientRect().width
    const travelled = g.startX - e.clientX
    if (e.type !== 'pointercancel' && travelled >= width * COMMIT_FRACTION) {
      setDeleting(true)
      setDx(-width)
      onDelete()
      gesture.current = null
      setSwiping(false)
    } else {
      reset()
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
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onClickCapture,
    },
  }
}
