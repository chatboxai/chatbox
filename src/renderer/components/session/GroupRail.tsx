import { ActionIcon, Box, Paper, Stack, Tooltip } from '@mantine/core'
import { IconFolders, IconInbox, IconStarFilled } from '@tabler/icons-react'
import { useAtom } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentSidebarGroupIdAtom } from '@/stores/atoms/uiAtoms'
import { useGroups } from '@/stores/groupStore'
import { getGroupPath, STARRED_GROUP_ID } from '@/utils/group-tree'
import GroupTreeFlyout from './GroupTreeFlyout'

const RAIL_W = 40

/**
 * Thin always-on rail at the left of the session panel. Hovering it (or its flyout) opens the
 * nested group tree; picking a group enters it and the flyout auto-hides. The rail also shows a
 * compact breadcrumb of the entered group's path as color dots.
 */
export default function GroupRail() {
  const { t } = useTranslation()
  const { groups } = useGroups()
  const [currentGroupId] = useAtom(currentSidebarGroupIdAtom)
  const path = useMemo(() => getGroupPath(groups ?? [], currentGroupId), [groups, currentGroupId])
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const openNow = () => {
    cancelClose()
    setOpen(true)
  }
  const closeSoon = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <Box
      className="relative shrink-0 border-chatbox-border-primary border-r"
      style={{ width: RAIL_W }}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <Stack align="center" gap={6} pt="xs">
        <Tooltip label={t('Groups')} position="right" openDelay={400} withArrow>
          <ActionIcon
            variant={open ? 'light' : 'subtle'}
            color="chatbox-tertiary"
            size={28}
            aria-label={t('Groups') ?? ''}
            onClick={openNow}
          >
            <IconFolders size={18} />
          </ActionIcon>
        </Tooltip>

        {currentGroupId === STARRED_GROUP_ID ? (
          <IconStarFilled size={14} style={{ color: 'var(--mantine-color-yellow-6)' }} />
        ) : currentGroupId === null ? (
          <IconInbox size={14} className="text-chatbox-tertiary" />
        ) : (
          path.map((g) => (
            <Box
              key={g.id}
              w={8}
              h={8}
              style={{
                borderRadius: '50%',
                background: g.color || 'var(--mantine-color-chatbox-tertiary-text)',
              }}
            />
          ))
        )}
      </Stack>

      {open && (
        <Paper
          shadow="md"
          withBorder
          className="absolute top-0 z-30"
          style={{ left: RAIL_W, width: 250, maxHeight: '72vh', overflow: 'hidden' }}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <GroupTreeFlyout onNavigate={() => setOpen(false)} />
        </Paper>
      )}
    </Box>
  )
}
