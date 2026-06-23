import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Divider, Flex, Menu, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import type { SessionGroup } from '@shared/types'
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconInbox,
  IconPalette,
  IconPencil,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react'
import { useAtom } from 'jotai'
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentSidebarGroupIdAtom, expandedGroupsAtom } from '@/stores/atoms/uiAtoms'
import { useGroupSessionCount, useStarredSessions } from '@/stores/chatStore'
import { deleteGroup, MAX_GROUP_DEPTH, updateGroup, useGroups } from '@/stores/groupStore'
import { duplicateGroup, reorderChildGroups, reorderGroups } from '@/stores/session/groups'
import { add as addToast } from '@/stores/toastActions'
import { buildGroupTree, type GroupTreeNode, STARRED_GROUP_ID } from '@/utils/group-tree'

const INDENT_PX = 18

/** The nested group tree shown in the rail flyout. Clicking a group "enters" it (onNavigate closes the flyout). */
export default function GroupTreeFlyout({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { groups } = useGroups()
  const tree = useMemo(() => buildGroupTree(groups ?? []), [groups])
  const [currentGroupId, setCurrentGroupId] = useAtom(currentSidebarGroupIdAtom)
  const [expandedMap, setExpandedMap] = useAtom(expandedGroupsAtom)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const enter = useCallback(
    (id: string | null) => {
      setCurrentGroupId(id)
      onNavigate?.()
    },
    [setCurrentGroupId, onNavigate]
  )
  const isExpanded = useCallback((id: string) => expandedMap[id] !== false, [expandedMap])
  const toggle = useCallback((id: string) => setExpandedMap((m) => ({ ...m, [id]: m[id] === false })), [setExpandedMap])

  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 10 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const rootIds = useMemo(() => tree.map((n) => n.group.id), [tree])
  const onGroupDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || !groups) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const a = groups.find((g) => g.id === activeId)
    const o = groups.find((g) => g.id === overId)
    // Only reorder among siblings (same parent); cross-level drags are ignored.
    if (!a || !o || (a.parentId ?? null) !== (o.parentId ?? null)) return
    const siblings = groups
      .filter((g) => (g.parentId ?? null) === (a.parentId ?? null))
      .sort((x, y) => x.sortIndex - y.sortIndex)
    const oldIndex = siblings.findIndex((g) => g.id === activeId)
    const newIndex = siblings.findIndex((g) => g.id === overId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    if (a.parentId === null) await reorderGroups(oldIndex, newIndex)
    else await reorderChildGroups(a.parentId, oldIndex, newIndex)
  }

  return (
    <Stack gap={2} p="xs">
      <UngroupedRow active={currentGroupId === null} onEnter={() => enter(null)} />
      <StarredRow active={currentGroupId === STARRED_GROUP_ID} onEnter={() => enter(STARRED_GROUP_ID)} />

      <Divider my={4} />

      <Flex align="center" justify="space-between" px="xs" pb={2}>
        <Text size="xs" fw={700} c="chatbox-tertiary" tt="uppercase">
          {t('Groups')}
        </Text>
        <ActionIcon
          variant="subtle"
          color="chatbox-tertiary"
          size={20}
          aria-label={t('New group') ?? ''}
          onClick={() => void NiceModal.show('create-group')}
        >
          <IconFolderPlus size={16} />
        </ActionIcon>
      </Flex>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis]}
        collisionDetection={closestCenter}
        onDragEnd={onGroupDragEnd}
      >
        <ScrollArea.Autosize mah={380} type="hover" scrollbarSize={6}>
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            <Stack gap={2} pr={4}>
              {tree.map((node) => (
                <GroupRow
                  key={node.group.id}
                  node={node}
                  currentGroupId={currentGroupId}
                  isExpanded={isExpanded}
                  toggle={toggle}
                  enter={enter}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                />
              ))}
            </Stack>
          </SortableContext>
        </ScrollArea.Autosize>
      </DndContext>
    </Stack>
  )
}

function UngroupedRow({ active, onEnter }: { active: boolean; onEnter: () => void }) {
  const { t } = useTranslation()
  const count = useGroupSessionCount(null)
  return (
    <RowShell
      depth={1}
      active={active}
      onClick={onEnter}
      icon={<IconInbox size={18} className="shrink-0 text-chatbox-tertiary" />}
      label={
        <Text span size="sm" fw={600} lineClamp={1} c="chatbox-primary">
          {t('Ungrouped')}
        </Text>
      }
      count={count}
    />
  )
}

function StarredRow({ active, onEnter }: { active: boolean; onEnter: () => void }) {
  const { t } = useTranslation()
  const { total } = useStarredSessions()
  return (
    <RowShell
      depth={1}
      active={active}
      onClick={onEnter}
      icon={<IconStarFilled size={16} className="shrink-0" style={{ color: 'var(--mantine-color-yellow-6)' }} />}
      label={
        <Text span size="sm" fw={600} lineClamp={1} c="chatbox-primary">
          {t('Starred')}
        </Text>
      }
      count={total}
    />
  )
}

interface GroupRowProps {
  node: GroupTreeNode
  currentGroupId: string | null
  isExpanded: (id: string) => boolean
  toggle: (id: string) => void
  enter: (id: string) => void
  renamingId: string | null
  setRenamingId: (id: string | null) => void
}

function GroupRow(props: GroupRowProps) {
  const { node, currentGroupId, isExpanded, toggle, enter, renamingId, setRenamingId } = props
  const { group, depth, children } = node
  const count = useGroupSessionCount(group.id)
  const hasChildren = children.length > 0
  const expanded = isExpanded(group.id)
  const active = currentGroupId === group.id
  const renaming = renamingId === group.id
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: group.id,
    disabled: renaming,
  })
  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  return (
    <>
      <div ref={setNodeRef} style={dndStyle} {...attributes} {...listeners}>
        <RowShell
          depth={depth}
          active={active}
          onClick={() => enter(group.id)}
          chevron={
            hasChildren ? (
              <ActionIcon
                variant="transparent"
                size={16}
                color="chatbox-tertiary"
                aria-label="toggle"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(group.id)
                }}
              >
                {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </ActionIcon>
            ) : null
          }
          icon={
            <IconFolder
              size={depth === 1 ? 18 : 15}
              className="shrink-0"
              style={{
                color: group.color || 'var(--mantine-color-chatbox-tertiary-text)',
                opacity: depth === 1 ? 1 : 0.85,
              }}
            />
          }
          label={
            renaming ? (
              <RenameInput group={group} onDone={() => setRenamingId(null)} />
            ) : (
              <Text
                span
                size={depth <= 2 ? 'sm' : 'xs'}
                fw={depth === 1 ? 600 : depth === 2 ? 500 : 400}
                lineClamp={1}
                c="chatbox-primary"
              >
                {group.name}
              </Text>
            )
          }
          count={renaming ? undefined : count}
          actions={renaming ? null : <GroupMenu group={group} depth={depth} onRename={() => setRenamingId(group.id)} />}
        />
      </div>
      {expanded && hasChildren && (
        <SortableContext items={children.map((c) => c.group.id)} strategy={verticalListSortingStrategy}>
          {children.map((child) => (
            <GroupRow
              key={child.group.id}
              node={child}
              currentGroupId={currentGroupId}
              isExpanded={isExpanded}
              toggle={toggle}
              enter={enter}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
            />
          ))}
        </SortableContext>
      )}
    </>
  )
}

interface RowShellProps {
  depth: number
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: React.ReactNode
  count?: number
  chevron?: React.ReactNode
  actions?: React.ReactNode
}

function RowShell({ depth, active, onClick, icon, label, count, chevron, actions }: RowShellProps) {
  return (
    <Flex
      align="center"
      gap={4}
      pr="xs"
      py={4}
      className={`group/grouprow cursor-pointer rounded-sm ${active ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'}`}
      onClick={onClick}
    >
      <Box w={6} className="shrink-0" />
      {Array.from({ length: Math.max(0, depth - 1) }).map((_, i) => (
        <Box
          // biome-ignore lint/suspicious/noArrayIndexKey: positional indent guide
          key={i}
          className="shrink-0 self-stretch"
          style={{ width: INDENT_PX, borderLeft: '1px solid var(--mantine-color-default-border)' }}
        />
      ))}
      <Box w={18} className="flex shrink-0 items-center justify-center">
        {chevron}
      </Box>
      {icon}
      <Box flex={1} style={{ minWidth: 0 }}>
        {label}
      </Box>
      {typeof count === 'number' && count > 0 && (
        <Text span size="xs" c="chatbox-tertiary" className="shrink-0">
          {count}
        </Text>
      )}
      {actions && <Box className="shrink-0 invisible group-hover/grouprow:visible">{actions}</Box>}
    </Flex>
  )
}

function RenameInput({ group, onDone }: { group: SessionGroup; onDone: () => void }) {
  const [value, setValue] = useState(group.name)
  const commit = async () => {
    const next = value.trim()
    if (next && next !== group.name) {
      try {
        await updateGroup(group.id, { name: next })
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err))
      }
    }
    onDone()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDone()
    }
  }
  return (
    <TextInput
      size="xs"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function GroupMenu({ group, depth, onRename }: { group: SessionGroup; depth: number; onRename: () => void }) {
  const { t } = useTranslation()
  const canNest = depth < MAX_GROUP_DEPTH
  const handleDelete = async () => {
    const ok = (await NiceModal.show('confirm-dangerous-action', {
      type: 'delete_group',
      description: t('Delete group "{{name}}"? Sessions will be moved to Unassigned.', { name: group.name }),
    })) as boolean
    if (ok) await deleteGroup(group.id)
  }
  return (
    <Menu position="bottom-end" withinPortal shadow="md" width={190}>
      <Menu.Target>
        <ActionIcon
          variant="transparent"
          size={18}
          color="chatbox-tertiary"
          aria-label={t('Group actions') ?? ''}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={15} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {canNest && (
          <Menu.Item
            leftSection={<IconFolderPlus size={14} />}
            onClick={() => void NiceModal.show('create-group', { parentId: group.id })}
          >
            {t('New subgroup')}
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={onRename}>
          {t('Rename group')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconPalette size={14} />}
          onClick={() => void NiceModal.show('set-group-color', { groupId: group.id })}
        >
          {t('Set color')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconCopy size={14} />}
          onClick={async () => {
            try {
              await duplicateGroup(group.id)
              addToast(t('Group duplicated'))
            } catch (err) {
              addToast(err instanceof Error ? err.message : t('Failed to duplicate group'))
            }
          }}
        >
          {t('Duplicate group')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => void handleDelete()}>
          {t('Delete group')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
