import { useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Checkbox from '@mui/material/Checkbox'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import type { Item } from '../api/types'
import { REVEAL_WIDTH_PX, useRowSwipe } from './useRowSwipe'

// Where a note's text starts, so it lines up with the item names above and
// below it: the 20px drag-handle column + its 4px gap + a 42px medium
// Checkbox. A note has neither, but the column of names stays one column.
const NOTE_TEXT_INSET_PX = 66

interface ItemRowProps {
  item: Item
  // Sortable rows (unchecked section) get a drag handle.
  sortable: boolean
  flash: boolean
  onToggle: (item: Item) => void
  onToggleNote: (item: Item) => void
  onDelete: (item: Item) => void
}

export default function ItemRow({
  item,
  sortable,
  flash,
  onToggle,
  onToggleNote,
  onDelete,
}: ItemRowProps) {
  const swipe = useRowSwipe({
    onSwipeLeft: () => onDelete(item),
    onSwipeRight: () => onToggleNote(item),
  })
  const rowRef = useRef<HTMLLIElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !sortable || swipe.swiping || swipe.revealed !== null,
    // Skip dnd-kit's post-drop FLIP layout animation: the synchronous reorder
    // in handleDragEnd (queryClient.applyReorderOptimistic) already lands the
    // row in its correct slot on drop, so the FLIP only adds a spurious slide
    // that reads as an upward "jump" on up-drags. The during-drag make-room
    // animation is driven by isSorting, not this flag, so it is unaffected.
    animateLayoutChanges: () => false,
  })

  useEffect(() => {
    if (flash) {
      rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [flash])

  const noteAction = item.note ? `Make ${item.name} an item` : `Make ${item.name} a note`

  return (
    <ListItem
      ref={(node: HTMLLIElement | null) => {
        rowRef.current = node
        setNodeRef(node)
      }}
      disablePadding
      data-testid={`item-row-${item.name}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        // Keyboard fallbacks for the two swipe directions.
        if (e.key === 'Delete' || e.key === 'Backspace') {
          onDelete(item)
        } else if (e.key === 'n' || e.key === 'N') {
          onToggleNote(item)
        }
      }}
      tabIndex={0}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.85 : 1,
        touchAction: 'pan-y',
        '@keyframes rowFlash': {
          '0%': { backgroundColor: 'transparent' },
          '25%': { backgroundColor: 'rgba(255, 193, 7, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
      }}
    >
      {/* Red delete backdrop revealed as the row slides left. visibility
          (not opacity) keeps the hidden button out of hit-testing and the
          accessibility tree while the row is closed. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'flex-end',
          bgcolor: 'error.main',
          color: 'error.contrastText',
          visibility: swipe.dx < 0 ? 'visible' : 'hidden',
        }}
      >
        <ButtonBase
          aria-label={`Delete ${item.name}`}
          onClick={() => onDelete(item)}
          sx={{ width: REVEAL_WIDTH_PX }}
        >
          <DeleteIcon />
        </ButtonBase>
      </Box>

      {/* Slate note backdrop, mirrored: revealed as the row slides right. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          bgcolor: 'note.main',
          color: 'note.contrastText',
          visibility: swipe.dx > 0 ? 'visible' : 'hidden',
        }}
      >
        <ButtonBase
          aria-label={noteAction}
          onClick={() => onToggleNote(item)}
          sx={{ width: REVEAL_WIDTH_PX }}
        >
          {item.note ? <CheckBoxOutlineBlankIcon /> : <StickyNote2Icon />}
        </ButtonBase>
      </Box>

      {/* Sliding row content */}
      <Box
        {...swipe.handlers}
        data-testid={`item-swipe-${item.name}`}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          minHeight: 48,
          px: 1,
          py: item.note ? 0.75 : 0,
          bgcolor: item.note ? 'note.ground' : 'background.paper',
          transform: `translateX(${swipe.dx}px)`,
          transition: swipe.swiping ? 'none' : 'transform 200ms ease',
          animation: flash ? 'rowFlash 2s ease' : undefined,
          cursor: 'default',
        }}
      >
        {item.note ? (
          // Marginalia: a rule in the margin, the text still in the names
          // column. No checkbox — a note is never checked (§3) — and no drag
          // handle, since notes are pinned to the top of the list.
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              bgcolor: 'note.rule',
            }}
          />
        ) : (
          <>
            {/* Always occupies the handle column so checkboxes line up across both sections. */}
            <Box
              {...(sortable ? attributes : {})}
              {...(sortable ? listeners : {})}
              aria-label={sortable ? `Reorder ${item.name}` : undefined}
              aria-hidden={sortable ? undefined : true}
              sx={{
                display: 'flex',
                alignItems: 'center',
                color: 'text.disabled',
                cursor: sortable ? 'grab' : 'default',
                touchAction: 'none',
                mr: 0.5,
                width: 20,
                flexShrink: 0,
              }}
            >
              {sortable && <DragIndicatorIcon fontSize="small" />}
            </Box>
            <Checkbox
              checked={item.checked}
              onChange={() => onToggle(item)}
              slotProps={{ input: { 'aria-label': item.name } }}
            />
          </>
        )}
        <ListItemText
          primary={item.name}
          sx={
            item.note
              ? { ml: `${NOTE_TEXT_INSET_PX}px`, my: 0 }
              : item.checked
                ? { textDecoration: 'line-through', color: 'text.secondary' }
                : undefined
          }
          slotProps={
            // A note is a sentence, not a noun: give it room to breathe over
            // two lines where an item name rarely needs one.
            item.note ? { primary: { sx: { lineHeight: 1.45 } } } : undefined
          }
        />
      </Box>
    </ListItem>
  )
}
