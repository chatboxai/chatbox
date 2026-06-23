import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex, Stack, Text, TextInput } from '@mantine/core'
import { IconCheck, IconFolder, IconFolderPlus, IconInbox, IconX } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Fragment, type KeyboardEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { getMetaStorage } from '@/stores/chatStore'
import { createGroup, useGroups } from '@/stores/groupStore'
import { moveSessionToGroup } from '@/stores/sessionActions'
import { add as addToast } from '@/stores/toastActions'
import { buildGroupTree, type GroupTreeNode } from '@/utils/group-tree'

interface Props {
  sessionId: string
}

const SEARCH_THRESHOLD = 10
const INDENT_PX = 18

const MoveSessionToGroup = NiceModal.create(({ sessionId }: Props) => {
  const modal = useModal()
  const { t } = useTranslation()
  const { groups } = useGroups()
  // Read the session's current group straight from the meta store — the global session list query
  // may not be populated in the file-explorer view, so it can't be relied on for the checkmark.
  const { data: currentGroupId = null } = useQuery({
    queryKey: ['move-modal-session-group', sessionId],
    queryFn: async () => (await (await getMetaStorage()).getById(sessionId))?.groupId ?? null,
    staleTime: 0,
  })

  const [creating, setCreating] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [query, setQuery] = useState('')

  const resetState = () => {
    setSubmitting(false)
    setCreating(false)
    setNewGroupName('')
    setQuery('')
  }

  const onClose = () => {
    resetState()
    modal.resolve()
    modal.hide()
  }

  const tree = useMemo(() => buildGroupTree(groups ?? []), [groups])
  const q = query.trim().toLowerCase()
  const searchMatches = useMemo(
    () => (q ? (groups ?? []).filter((g) => g.name.toLowerCase().includes(q)) : []),
    [groups, q]
  )
  const showSearch = (groups?.length ?? 0) > SEARCH_THRESHOLD

  const doMove = async (targetGroupId: string | null) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await moveSessionToGroup(sessionId, targetGroupId)
      resetState()
      modal.resolve(targetGroupId)
      modal.hide()
    } catch (error) {
      console.error('Failed to move session:', error)
      addToast(t('Failed to move session'))
      setSubmitting(false)
    }
  }

  const confirmCreate = async () => {
    const name = newGroupName.trim()
    if (!name || submitting) return
    setSubmitting(true)
    try {
      const group = await createGroup({ name })
      await moveSessionToGroup(sessionId, group.id)
      resetState()
      modal.resolve(group.id)
      modal.hide()
    } catch (error) {
      console.error('Failed to create group:', error)
      addToast(t('Failed to move session'))
      setSubmitting(false)
    }
  }

  const cancelCreate = () => {
    setCreating(false)
    setNewGroupName('')
  }

  const handleCreateKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void confirmCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelCreate()
    }
  }

  const renderRow = (
    key: string,
    label: string,
    icon: React.ReactNode,
    selected: boolean,
    onClick: () => void,
    depth = 1
  ) => (
    <Flex
      key={key}
      align="center"
      gap="sm"
      px="sm"
      py="xs"
      className={`cursor-pointer rounded-sm ${
        selected ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'
      }`}
      style={{ paddingLeft: (depth - 1) * INDENT_PX + 12 }}
      onClick={onClick}
    >
      {icon}
      <Text flex={1} lineClamp={1} c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
        {label}
      </Text>
      {selected && <IconCheck size={16} className="text-chatbox-brand" />}
    </Flex>
  )

  const renderNode = (node: GroupTreeNode): React.ReactNode => (
    <Fragment key={node.group.id}>
      {renderRow(
        node.group.id,
        node.group.name,
        <IconFolder
          size={16}
          className="shrink-0"
          style={{ color: node.group.color || 'var(--mantine-color-chatbox-tertiary-text)' }}
        />,
        currentGroupId === node.group.id,
        () => void doMove(node.group.id),
        node.depth
      )}
      {node.children.map(renderNode)}
    </Fragment>
  )

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} size="md" centered title={t('Move to group')}>
      <Stack gap="xs">
        {showSearch && (
          <TextInput
            size="sm"
            placeholder={t('Search') ?? ''}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        )}

        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <Stack gap={2}>
            {renderRow(
              '__unassigned__',
              t('Unassigned'),
              <IconInbox size={18} className="shrink-0 text-chatbox-tertiary" />,
              currentGroupId === null,
              () => void doMove(null),
              1
            )}

            {q ? (
              searchMatches.length > 0 ? (
                searchMatches.map((g) =>
                  renderRow(
                    g.id,
                    g.name,
                    <IconFolder
                      size={16}
                      className="shrink-0"
                      style={{ color: g.color || 'var(--mantine-color-chatbox-tertiary-text)' }}
                    />,
                    currentGroupId === g.id,
                    () => void doMove(g.id),
                    1
                  )
                )
              ) : (
                <Text size="sm" c="chatbox-tertiary" px="sm" py="xs">
                  {t('No groups found')}
                </Text>
              )
            ) : (
              tree.map(renderNode)
            )}

            {creating ? (
              <Flex align="center" gap="xs" px="sm" py="xs">
                <IconFolderPlus size={18} className="text-chatbox-tertiary" />
                <TextInput
                  size="sm"
                  flex={1}
                  autoFocus
                  placeholder={t('New group name') ?? ''}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.currentTarget.value)}
                  onKeyDown={handleCreateKey}
                  disabled={submitting}
                />
                <ActionIcon
                  variant="subtle"
                  size={24}
                  color="chatbox-brand"
                  onClick={() => void confirmCreate()}
                  disabled={submitting || !newGroupName.trim()}
                  aria-label={t('Confirm') ?? 'Confirm'}
                >
                  <IconCheck size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  size={24}
                  color="chatbox-tertiary"
                  onClick={cancelCreate}
                  disabled={submitting}
                  aria-label={t('Cancel') ?? 'Cancel'}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Flex>
            ) : (
              <Flex
                align="center"
                gap="sm"
                px="sm"
                py="xs"
                className="cursor-pointer rounded-sm hover:bg-chatbox-background-gray-secondary"
                onClick={() => setCreating(true)}
              >
                <IconFolderPlus size={18} className="text-chatbox-tertiary" />
                <Text flex={1} c="chatbox-tertiary">
                  {t('Create new group…')}
                </Text>
              </Flex>
            )}
          </Stack>
        </div>
      </Stack>

      <AdaptiveModal.Actions>
        <Button variant="default" onClick={onClose}>
          {t('Cancel')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
})

export default MoveSessionToGroup
