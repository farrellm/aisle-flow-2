import { useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Checkbox from '@mui/material/Checkbox'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import type { Item } from '../api/types'
import { REVEAL_WIDTH_PX, useSwipeToDelete } from './useSwipeToDelete'

interface ItemRowProps {
  item: Item
  // Sortable rows (unchecked section) get a drag handle.
  sortable: boolean
  flash: boolean
  onToggle: (item: Item) => void
  onDelete: (item: Item) => void
}

export default function ItemRow({ item, sortable, flash, onToggle, onDelete }: ItemRowProps) {
  const swipe = useSwipeToDelete(() => onDelete(item))
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
    disabled: !sortable || swipe.swiping || swipe.revealed,
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

  return (
    <ListItem
      ref={(node: HTMLLIElement | null) => {
        rowRef.current = node
        setNodeRef(node)
      }}
      disablePadding
      data-testid={`item-row-${item.name}`}
      onKeyDown={(e) => {
        // Keyboard fallback for swipe-to-delete.
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === e.currentTarget) {
          onDelete(item)
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

      {/* Sliding row content */}
      <Box
        {...swipe.handlers}
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          minHeight: 48,
          px: 1,
          bgcolor: 'background.paper',
          transform: `translateX(${swipe.dx}px)`,
          transition: swipe.swiping ? 'none' : 'transform 200ms ease',
          animation: flash ? 'rowFlash 2s ease' : undefined,
          cursor: 'default',
        }}
      >
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
        <ListItemText
          primary={item.name}
          sx={
            item.checked
              ? { textDecoration: 'line-through', color: 'text.secondary' }
              : undefined
          }
        />
      </Box>
    </ListItem>
  )
}
