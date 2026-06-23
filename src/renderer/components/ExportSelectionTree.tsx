import { ActionIcon, Box, Checkbox, Collapse, Flex, Stack, Text } from '@mantine/core'
import type { SessionGroup, SessionMeta } from '@shared/types'
import { IconChevronDown, IconChevronRight, IconFolder, IconInbox } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UNASSIGNED_ID } from '@/lib/export-helpers'
import { isSystemSession } from '@/utils/session-utils'

// TODO(phase-5): if a single group exceeds ~500 sessions consider tanstack/react-virtual
// to keep checkbox renders cheap when the user expands it.

export interface ExportSelectionValue {
  groupIds: Set<string>
  sessionIds: Set<string>
}

export interface ExportSelectionTreeProps {
  groups: SessionGroup[]
  sessions: SessionMeta[]
  value: ExportSelectionValue
  onChange: (next: ExportSelectionValue) => void
  disabled?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
}

interface BucketView {
  id: string
  label: string
  isUnassigned: boolean
  sessions: SessionMeta[]
}

export default function ExportSelectionTree({
  groups,
  sessions,
  value,
  onChange,
  disabled = false,
  isExpanded,
  onToggleExpand,
}: ExportSelectionTreeProps) {
  const { t } = useTranslation()

  const [internalExpanded, setInternalExpanded] = useState(false)
  const expanded = isExpanded ?? internalExpanded
  const toggleExpanded = () => {
    if (onToggleExpand) {
      onToggleExpand()
    } else {
      setInternalExpanded((v) => !v)
    }
  }

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const toggleGroup = (id: string) => {
    setOpenGroups((m) => ({ ...m, [id]: !m[id] }))
  }

  const visibleSessions = useMemo(
    () => sessions.filter((s) => !isSystemSession(s) && !s.hidden),
    [sessions]
  )

  const buckets = useMemo<BucketView[]>(() => {
    const byGroup = new Map<string, SessionMeta[]>()
    const unassigned: SessionMeta[] = []
    for (const s of visibleSessions) {
      if (s.groupId) {
        const arr = byGroup.get(s.groupId) ?? []
        arr.push(s)
        byGroup.set(s.groupId, arr)
      } else {
        unassigned.push(s)
      }
    }
    const sortedGroups = [...groups].sort((a, b) => a.sortIndex - b.sortIndex)
    const result: BucketView[] = sortedGroups.map((g) => ({
      id: g.id,
      label: g.name,
      isUnassigned: false,
      sessions: byGroup.get(g.id) ?? [],
    }))
    // Hide the Unassigned row entirely when no sessions live there to avoid noise.
    if (unassigned.length > 0) {
      result.push({
        id: UNASSIGNED_ID,
        label: t('Unassigned'),
        isUnassigned: true,
        sessions: unassigned,
      })
    }
    return result
  }, [groups, visibleSessions, t])

  const totalCount = visibleSessions.length
  const selectedCount = useMemo(() => {
    let n = 0
    for (const s of visibleSessions) {
      if (value.sessionIds.has(s.id)) n++
    }
    return n
  }, [visibleSessions, value.sessionIds])

  const triggerLabel = `${t('Select conversations to export')} — ${t('{{selected}} of {{total}} selected', {
    selected: selectedCount,
    total: totalCount,
  })}`

  const setBucketSelected = (bucket: BucketView, allSelected: boolean) => {
    const nextSessions = new Set(value.sessionIds)
    const nextGroups = new Set(value.groupIds)
    for (const s of bucket.sessions) {
      if (allSelected) nextSessions.add(s.id)
      else nextSessions.delete(s.id)
    }
    if (bucket.isUnassigned) {
      // Unassigned has no group entry, just session ids.
    } else if (allSelected) {
      nextGroups.add(bucket.id)
    } else {
      nextGroups.delete(bucket.id)
    }
    onChange({ groupIds: nextGroups, sessionIds: nextSessions })
  }

  const toggleSession = (bucket: BucketView, sessionId: string, checked: boolean) => {
    const nextSessions = new Set(value.sessionIds)
    if (checked) nextSessions.add(sessionId)
    else nextSessions.delete(sessionId)
    const nextGroups = new Set(value.groupIds)
    if (!bucket.isUnassigned) {
      const allChecked = bucket.sessions.every((s) => nextSessions.has(s.id))
      if (allChecked && bucket.sessions.length > 0) nextGroups.add(bucket.id)
      else nextGroups.delete(bucket.id)
    }
    onChange({ groupIds: nextGroups, sessionIds: nextSessions })
  }

  return (
    <Stack gap="xs">
      <Flex
        align="center"
        gap="xs"
        className={`cursor-pointer rounded-sm select-none ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={toggleExpanded}
      >
        <ActionIcon
          variant="transparent"
          size={20}
          color="chatbox-tertiary"
          aria-label={expanded ? t('Collapse') : t('Expand')}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded()
          }}
        >
          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </ActionIcon>
        <Text size="sm" c="chatbox-primary" flex={1}>
          {triggerLabel}
        </Text>
      </Flex>

      <Collapse in={expanded}>
        <Box
          className="border border-solid border-chatbox-border-secondary rounded-sm"
          p="xs"
          style={{ maxHeight: '40vh', overflowY: 'auto' }}
        >
          {buckets.length === 0 ? (
            <Text size="sm" c="chatbox-tertiary" px="xs" py="xs">
              {t('No conversations to select')}
            </Text>
          ) : (
            <Stack gap={2}>
              {buckets.map((bucket) => {
                const total = bucket.sessions.length
                const selectedInBucket = bucket.sessions.reduce(
                  (acc, s) => acc + (value.sessionIds.has(s.id) ? 1 : 0),
                  0
                )
                const allChecked = total > 0 && selectedInBucket === total
                const indeterminate = selectedInBucket > 0 && selectedInBucket < total
                const isOpen = !!openGroups[bucket.id]

                return (
                  <Box key={bucket.id}>
                    <Flex align="center" gap="xs" px="xs" py={4}>
                      <ActionIcon
                        variant="transparent"
                        size={18}
                        color="chatbox-tertiary"
                        aria-label={isOpen ? t('Collapse') : t('Expand')}
                        onClick={() => toggleGroup(bucket.id)}
                        disabled={disabled || total === 0}
                      >
                        {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      </ActionIcon>
                      <Checkbox
                        size="xs"
                        disabled={disabled || total === 0}
                        // indeterminate must be paired with checked=false for Mantine to render the dash.
                        checked={allChecked}
                        indeterminate={indeterminate}
                        onChange={() => {
                          // indeterminate → all; otherwise toggle.
                          if (indeterminate) setBucketSelected(bucket, true)
                          else setBucketSelected(bucket, !allChecked)
                        }}
                      />
                      {bucket.isUnassigned ? (
                        <IconInbox size={14} className="text-chatbox-tertiary shrink-0" />
                      ) : (
                        <IconFolder size={14} className="text-chatbox-tertiary shrink-0" />
                      )}
                      <Text size="sm" flex={1} lineClamp={1} c="chatbox-primary">
                        {bucket.label}{' '}
                        <Text span size="xs" c="chatbox-tertiary">
                          ({selectedInBucket}/{total})
                        </Text>
                      </Text>
                    </Flex>

                    <Collapse in={isOpen}>
                      <Stack gap={2} pl={32} py={2}>
                        {bucket.sessions.length === 0 ? (
                          <Text size="xs" c="chatbox-tertiary">
                            {t('No conversations to select')}
                          </Text>
                        ) : (
                          bucket.sessions.map((s) => (
                            <Checkbox
                              key={s.id}
                              size="xs"
                              disabled={disabled}
                              checked={value.sessionIds.has(s.id)}
                              label={
                                <Text size="sm" lineClamp={1}>
                                  {s.name}
                                </Text>
                              }
                              onChange={(e) => toggleSession(bucket, s.id, e.currentTarget.checked)}
                            />
                          ))
                        )}
                      </Stack>
                    </Collapse>
                  </Box>
                )
              })}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Stack>
  )
}
