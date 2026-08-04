import { Box } from '@mantine/core'
import type { SessionMetaRecord } from '@shared/types'
import clsx from 'clsx'
import { memo } from 'react'
import SessionItem from '@/components/session/SessionItem'

export interface SidebarSessionItemProps {
  session: SessionMetaRecord
  depth: number
  selected: boolean
  showTreeLine?: boolean
  isReordering?: boolean
  onStartReordering?: () => void
}

const INDENT_PX = 16

/**
 * Thin wrapper around the existing {@link SessionItem} that adds tree-aware
 * indentation and the vertical tree-line used by the folder tree and the pinned
 * section. The session row visuals (avatar, name, pin/archive actions, mobile
 * long-press menu) remain owned by SessionItem.
 *
 * The tree-line is drawn on the left edge aligned with the parent folder's
 * children, matching the wireframe's `│` rhythm. For the pinned section the
 * line is decorative only (no logical nesting).
 */
function SidebarSessionItem(props: SidebarSessionItemProps) {
  const { session, depth, selected, showTreeLine = true, isReordering, onStartReordering } = props

  return (
    <Box className="relative" style={{ paddingLeft: depth * INDENT_PX }}>
      {showTreeLine && depth > 0 && (
        <span
          aria-hidden
          className={clsx('absolute top-0 bottom-0 w-px bg-chatbox-border-primary opacity-40')}
          style={{ left: 0 }}
        />
      )}
      <SessionItem
        session={session}
        selected={selected}
        isReordering={isReordering}
        onStartReordering={onStartReordering}
      />
    </Box>
  )
}

export default memo(SidebarSessionItem)
