import { getSessionListGroup, getSessionListGroupRank } from '@chatbox/core/utils/session-sort'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
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
import { Button, Flex, Text, UnstyledButton } from '@mantine/core'
import { AutomationAdjacentAttr, TestId } from '@shared/automation/testids'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import {
  IconArrowsMoveVertical,
  IconDots,
  IconFolder,
  IconFolderOpen,
  IconGripVertical,
  IconLoader2,
  IconMessagePlus,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso } from 'react-virtuoso'
import { rendererApplication } from '@/app/renderer-application'
import { useAppTitleBarHeight } from '@/components/layout/AppTitleBar'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionSwitchHintDigits } from '@/hooks/useSessionSwitchHints'
import { useTouchLayout } from '@/hooks/useTouchLayout'
import platform from '@/platform'
import { setSessionAgentMode } from '@/stores/session/agent-mode'
import { reorderSessions } from '@/stores/session/crud'
import { deleteSessionFolder, moveSessionToFolder, renameSessionFolder } from '@/stores/session/folders'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { ICON_SIZE, IconButton } from '../common/IconButton'
import { ScalableIcon } from '../common/ScalableIcon'
import Broom from '../icons/Broom'
import SessionItem from './SessionItem'
import { useSidebarContextMenu } from './useSidebarContextMenu'

const useSessionList = () => rendererApplication.sessionHooks.useSessionList()
const useSessionFolders = () => rendererApplication.sessionHooks.useSessionFolders()

const FOLDER_DROP_PREFIX = 'folder:'
const UNFILED_DROP_ID = 'section:chats'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
  atTopStateChange?: (atTop: boolean) => void
}

const PROJECTS_SECTION_ID = 'section:projects'

type SessionListItem =
  | { type: 'section'; id: string; label: string; droppable?: boolean }
  | { type: 'folder'; id: string; folder: SessionFolder; collapsed: boolean; empty: boolean }
  | { type: 'session'; id: string; session: SessionMetaRecord; nested: boolean }

/**
 * Builds the rendered rows from the loaded sessions, which arrive in display
 * order (pinned, folders, unfiled) one page at a time. A group header appears
 * once loading has reached that group, so a folder whose chats are still on a
 * later page is never shown as empty.
 */
function buildDisplayItems(
  sessions: SessionMetaRecord[],
  folders: SessionFolder[],
  collapsedFolderIds: readonly string[],
  hasNextPage: boolean,
  labels: { pinned: string; projects: string; chats: string }
): SessionListItem[] {
  const folderIds = folders.map((folder) => folder.id)
  const lastSession = sessions.at(-1)
  const loadedRank = hasNextPage && lastSession ? getSessionListGroupRank(lastSession, folderIds) : Infinity
  const byRank = new Map<number, SessionMetaRecord[]>()
  for (const session of sessions) {
    const rank = getSessionListGroupRank(session, folderIds)
    const group = byRank.get(rank)
    if (group) group.push(session)
    else byRank.set(rank, [session])
  }
  const sessionRows = (rank: number): SessionListItem[] =>
    (byRank.get(rank) ?? []).map((session) => ({
      type: 'session',
      id: session.id,
      session,
      nested: rank > 0 && rank <= folders.length,
    }))

  const pinned = sessionRows(0)
  const unfiledRank = folders.length + 1
  const unfiled = sessionRows(unfiledRank)
  // The projects header is where projects are created, so it stays even with no
  // projects or chats.
  const projectsHeader: SessionListItem = { type: 'section', id: PROJECTS_SECTION_ID, label: labels.projects }
  if (sessions.length === 0 && folders.length === 0) {
    return [projectsHeader]
  }

  const items: SessionListItem[] = []
  if (pinned.length > 0) {
    items.push({ type: 'section', id: 'section:pinned', label: labels.pinned }, ...pinned)
  }
  if (loadedRank >= 1) {
    items.push(projectsHeader)
  }
  folders.forEach((folder, index) => {
    const rank = index + 1
    if (rank > loadedRank) return
    const collapsed = collapsedFolderIds.includes(folder.id)
    const rows = sessionRows(rank)
    items.push({
      type: 'folder',
      id: `${FOLDER_DROP_PREFIX}${folder.id}`,
      folder,
      collapsed,
      empty: rows.length === 0 && rank < loadedRank,
    })
    if (!collapsed) items.push(...rows)
  })
  if (unfiledRank <= loadedRank) {
    items.push({ type: 'section', id: UNFILED_DROP_ID, label: labels.chats, droppable: folders.length > 0 }, ...unfiled)
  }
  return items
}

function SessionListLoadingFooter() {
  return (
    <Flex justify="center" py="xs">
      <IconLoader2 size={16} className="animate-spin" style={{ color: 'var(--mantine-color-dimmed)' }} />
    </Flex>
  )
}

function SessionListSectionHeader(props: { label: string; testId?: string; children?: ReactNode }) {
  const titleBarHeight = useAppTitleBarHeight()
  return (
    <Flex
      align="center"
      justify="space-between"
      mih={34}
      pl="md"
      pr="xs"
      pt={4}
      className={clsx(
        'group/section',
        titleBarHeight ? 'bg-chatbox-background-primary-hover' : 'bg-chatbox-background-primary'
      )}
    >
      <Text data-testid={props.testId} size="xs" fw={600} c="chatbox-tertiary">
        {props.label}
      </Text>
      {props.children}
    </Flex>
  )
}

function ChatsSectionMenu() {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const touchLayout = useTouchLayout()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  return (
    <ActionMenu
      position="bottom-end"
      items={[
        {
          text: t('Clear Conversation List'),
          icon: Broom,
          testId: TestId.sidebar.clearSessionList,
          onClick: () => {
            if (isSmallScreen) {
              setShowSidebar(false)
            }
            void NiceModal.show('clear-session-list')
          },
        },
      ]}
    >
      <IconButton
        icon={IconDots}
        iconSize={ICON_SIZE.inline}
        size={isSmallScreen ? 'md' : 'sm'}
        color="chatbox-tertiary"
        aria-label={t('More')}
        data-testid={TestId.sidebar.chatsSectionMenu}
        className={
          touchLayout
            ? undefined
            : 'opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[expanded=true]:opacity-100'
        }
      />
    </ActionMenu>
  )
}

function CreateProjectButton() {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  return (
    <IconButton
      icon={IconPlus}
      iconSize={ICON_SIZE.inline}
      size={isSmallScreen ? 'md' : 'sm'}
      color="chatbox-tertiary"
      aria-label={t('New project')}
      data-testid={TestId.sidebar.createProject}
      onClick={() => void NiceModal.show('session-folder-create')}
    />
  )
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const {
    sessionMetaList: sortedSessions,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoading,
  } = useSessionList()
  const { folders } = useSessionFolders()
  const collapsedFolderIds = useUIStore((state) => state.collapsedSessionFolderIds)
  const setSessionFolderCollapsed = useUIStore((state) => state.setSessionFolderCollapsed)
  // Digits appear only while the switch modifier is held (see the hook); the
  // rows read them by session id, so a pinned row keeps its own key.
  const switchShortcutDigits = useSessionSwitchHintDigits()
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const touchLayout = useTouchLayout()
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,
      tolerance: 8,
    },
  })
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 10,
    },
  })
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  })
  const sensors = useSensors(...(!touchLayout || isReordering ? [touchSensor] : []), mouseSensor, keyboardSensor)
  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }
  const onDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over || !sortedSessions) {
      return
    }
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    const activeSession = sortedSessions.find((s) => s.id === activeId)
    if (!activeSession || activeId === overId) {
      return
    }
    if (overId.startsWith(FOLDER_DROP_PREFIX) || overId === UNFILED_DROP_ID) {
      // Pinned chats stay pinned; filing one would not move it in the list.
      if (activeSession.starred) return
      const folderId = overId === UNFILED_DROP_ID ? undefined : overId.slice(FOLDER_DROP_PREFIX.length)
      if ((activeSession.folderId || undefined) !== folderId) {
        await moveSessionToFolder(activeId, folderId)
      }
      return
    }
    const overSession = sortedSessions.find((s) => s.id === overId)
    if (!overSession || Boolean(activeSession.starred) !== Boolean(overSession.starred)) {
      return
    }
    await reorderSessions(activeId, overId)
  }
  const onDragCancel = () => {
    setActiveDragId(null)
  }
  const displayItems = useMemo<SessionListItem[]>(() => {
    if (!sortedSessions) {
      return []
    }
    return buildDisplayItems(sortedSessions, folders ?? [], collapsedFolderIds, Boolean(hasNextPage), {
      pinned: t('Pinned'),
      projects: t('Projects'),
      chats: t('Chats'),
    })
  }, [sortedSessions, folders, collapsedFolderIds, hasNextPage, t])
  const groupedItems = useMemo(() => {
    const groups: { header: Extract<SessionListItem, { type: 'section' }>; count: number }[] = []
    const items: Exclude<SessionListItem, { type: 'section' }>[] = []
    for (const item of displayItems) {
      if (item.type === 'section') {
        groups.push({ header: item, count: 0 })
      } else {
        items.push(item)
        const group = groups.at(-1)
        if (group) group.count++
      }
    }
    return { groups, items, counts: groups.map((group) => group.count) }
  }, [displayItems])
  const sortableSessionIds = useMemo(
    () => displayItems.filter((item) => item.type === 'session').map((item) => item.id),
    [displayItems]
  )
  const activeDragItem = useMemo(
    () =>
      displayItems.find(
        (item): item is Extract<SessionListItem, { type: 'session' }> =>
          item.type === 'session' && item.id === activeDragId
      ),
    [activeDragId, displayItems]
  )
  const routerState = useRouterState()
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  // A page that ends inside a collapsed folder adds no visible rows, and
  // Virtuoso reports the end again only when the row count changes; keep
  // loading until the list reaches a group that is shown. A failed read stops
  // here; scrolling to the end retries it.
  const lastLoadedSession = sortedSessions?.at(-1)
  const lastLoadedCollapsed = useMemo(() => {
    if (!lastLoadedSession) return false
    const group = getSessionListGroup(
      lastLoadedSession,
      (folders ?? []).map((folder) => folder.id)
    )
    return group.kind === 'folder' && collapsedFolderIds.includes(group.folderId)
  }, [lastLoadedSession, folders, collapsedFolderIds])
  useEffect(() => {
    if (lastLoadedCollapsed && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [lastLoadedCollapsed, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  const virtuosoComponents = useMemo(
    () =>
      hasNextPage
        ? {
            Footer: SessionListLoadingFooter,
          }
        : {},
    [hasNextPage]
  )
  const isEmpty = Boolean(sortedSessions) && groupedItems.items.length === 0
  useEffect(() => {
    if (isEmpty) props.atTopStateChange?.(true)
  }, [isEmpty, props.atTopStateChange])

  if (isEmpty) {
    return (
      <Flex direction="column" flex={1} className="sidebar-session-list" ref={props.sessionListViewportRef}>
        <SessionListSectionHeader label={t('Projects')} testId={TestId.sidebar.projectsSection}>
          <CreateProjectButton />
        </SessionListSectionHeader>
      </Flex>
    )
  }

  return (
    <DndContext
      modifiers={[restrictToVerticalAxis]}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {!sortedSessions && isLoading && <SessionListLoadingFooter />}
      {sortedSessions && (
        <SortableContext items={sortableSessionIds} strategy={verticalListSortingStrategy}>
          {touchLayout && isReordering && (
            <Flex
              align="center"
              justify="space-between"
              mx="xs"
              mb={2}
              px="xs"
              py={6}
              className="rounded-md bg-chatbox-background-gray-secondary"
            >
              <Flex align="center" gap={6}>
                <IconArrowsMoveVertical size={16} className="text-chatbox-tertiary" />
                <Text size="sm" fw={500} c="chatbox-secondary">
                  {t('Adjust order')}
                </Text>
              </Flex>
              <Button variant="subtle" size="compact-sm" onClick={() => setIsReordering(false)}>
                {t('Done')}
              </Button>
            </Flex>
          )}
          <GroupedVirtuoso
            className="sidebar-session-list"
            atTopStateChange={props.atTopStateChange}
            atTopThreshold={0}
            style={{
              flex: 1,
              ...(platform.type === 'web'
                ? {
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }
                : {}),
            }}
            groupCounts={groupedItems.counts}
            computeItemKey={(index) => displayItems[index]?.id ?? index}
            scrollerRef={(ref) => {
              if (ref instanceof HTMLDivElement) {
                props.sessionListViewportRef.current = ref
              }
            }}
            endReached={onEndReached}
            components={virtuosoComponents}
            groupContent={(index) => {
              const item = groupedItems.groups[index].header
              const header =
                item.id === UNFILED_DROP_ID ? (
                  <SessionListSectionHeader label={item.label} testId={TestId.sidebar.chatsSection}>
                    <ChatsSectionMenu />
                  </SessionListSectionHeader>
                ) : item.id === PROJECTS_SECTION_ID ? (
                  <SessionListSectionHeader label={item.label} testId={TestId.sidebar.projectsSection}>
                    <CreateProjectButton />
                  </SessionListSectionHeader>
                ) : (
                  <SessionListSectionHeader label={item.label} testId={TestId.sidebar.pinnedSection} />
                )
              return item.droppable ? <DropTarget id={item.id}>{header}</DropTarget> : header
            }}
            itemContent={(index) => {
              const item = groupedItems.items[index]
              if (!item) return null
              if (item.type === 'folder') {
                return (
                  <FolderHeader
                    folder={item.folder}
                    collapsed={item.collapsed}
                    empty={item.empty}
                    isReordering={isReordering}
                    onToggle={() => setSessionFolderCollapsed(item.folder.id, !item.collapsed)}
                  />
                )
              }

              return (
                <SortableItem
                  id={item.session.id}
                  nested={item.nested}
                  disabled={Boolean(touchLayout && !isReordering)}
                  dragLabel={`${t('Adjust order')}: ${item.session.name}`}
                  showDragHandle={Boolean(touchLayout && isReordering)}
                >
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${item.session.id}`}
                    session={item.session}
                    hideAvatar={item.nested}
                    isReordering={Boolean(touchLayout && isReordering)}
                    onStartReordering={() => setIsReordering(true)}
                    switchShortcutDigit={switchShortcutDigits.get(item.session.id)}
                  />
                </SortableItem>
              )
            }}
          />
          <DragOverlay dropAnimation={null}>
            {activeDragItem ? (
              <div className={clsx('pointer-events-none', activeDragItem.nested && 'pl-[22px]')}>
                <div className="scale-[1.02] rounded-md bg-chatbox-background-primary shadow-lg">
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${activeDragItem.id}`}
                    session={activeDragItem.session}
                    hideAvatar={activeDragItem.nested}
                    isReordering={Boolean(touchLayout && isReordering)}
                  />
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </SortableContext>
      )}
    </DndContext>
  )
}

function SortableItem(props: {
  id: string
  nested?: boolean
  children?: React.ReactNode
  disabled?: boolean
  dragLabel?: string
  showDragHandle?: boolean
}) {
  const { id, children, disabled = false, dragLabel, showDragHandle = false } = props
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx('relative pb-1', !disabled && 'cursor-grab active:cursor-grabbing', props.nested && 'pl-[22px]')}
      {...(!disabled ? attributes : {})}
      {...(!disabled ? listeners : {})}
      aria-label={disabled ? undefined : dragLabel}
    >
      {children}
      {showDragHandle && (
        <span
          data-session-drag-handle
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center text-chatbox-tertiary"
        >
          <IconGripVertical size={18} />
        </span>
      )}
    </div>
  )
}

function DropTarget(props: { id: string; className?: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: props.id })
  return (
    <div
      ref={setNodeRef}
      className={clsx('rounded-md', props.className, isOver && 'bg-chatbox-background-brand-secondary')}
    >
      {props.children}
    </div>
  )
}

function FolderHeader(props: {
  folder: SessionFolder
  collapsed: boolean
  empty: boolean
  isReordering: boolean
  onToggle: () => void
}) {
  const { folder, collapsed, empty, onToggle } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const touchLayout = useTouchLayout()
  const {
    menuOpened,
    menuPortalTarget,
    longPressing,
    consumeClick,
    handleContextMenu,
    handleMenuChange,
    handlePointerDown,
    handlePointerMove,
    clearLongPressTimer,
  } = useSidebarContextMenu({ touchLayout, disabled: props.isReordering })
  const rename = async () => {
    const name = await NiceModal.show<string | null>('session-folder-name', {
      title: t('Rename project'),
      initialName: folder.name,
    })
    if (name && name !== folder.name) await renameSessionFolder(folder.id, name)
  }
  const navigate = useNavigate()
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  // A Work Mode chat in the project's directory is filed into the project once created.
  const { workingDirectory } = folder
  const startChat = (workingDirectory: string) => {
    setNewSessionState((prev) => ({ ...prev, workingDirectories: [workingDirectory] }))
    void setSessionAgentMode('new', 'on')
    void navigate({ to: '/' })
    if (isSmallScreen) setShowSidebar(false)
  }
  const menuItems: ActionMenuItemProps[] = [
    ...(workingDirectory
      ? [{ text: t('New Chat'), icon: IconMessagePlus, onClick: () => startChat(workingDirectory) }]
      : []),
    { text: t('Rename'), icon: IconPencil, onClick: () => void rename() },
    {
      text: t('Delete project'),
      icon: IconTrash,
      color: 'chatbox-error',
      doubleCheck: { text: t('Chats will be moved out of the project. Delete?') || undefined },
      onClick: () => void deleteSessionFolder(folder.id),
    },
  ]
  const header = (
    <Flex
      data-testid={TestId.sidebar.projectHeader}
      {...{ [AutomationAdjacentAttr.folderId]: folder.id }}
      align="center"
      gap={4}
      pl="xs"
      pr={4}
      className={clsx(
        'group/folder-header rounded-md select-none',
        touchLayout
          ? longPressing && 'bg-chatbox-background-gray-secondary'
          : 'hover:bg-chatbox-background-gray-secondary'
      )}
      onContextMenu={touchLayout ? handleContextMenu : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
    >
      <UnstyledButton
        aria-expanded={!collapsed}
        title={folder.workingDirectory}
        onClick={() => {
          if (!consumeClick()) onToggle()
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5"
      >
        <ScalableIcon
          icon={collapsed ? IconFolder : IconFolderOpen}
          size={16}
          className="shrink-0 text-chatbox-secondary"
        />
        <Text span size="sm" fw={500} c="chatbox-secondary" lineClamp={1}>
          {folder.name}
        </Text>
      </UnstyledButton>
      {!touchLayout && (
        <ActionMenu position="bottom-end" items={menuItems}>
          <IconButton
            icon={IconDots}
            iconSize={ICON_SIZE.inline}
            size={isSmallScreen ? 'md' : 'sm'}
            color="chatbox-tertiary"
            aria-label={t('Project actions') || undefined}
            className="opacity-0 group-hover/folder-header:opacity-100 focus-visible:opacity-100 data-[expanded=true]:opacity-100"
          />
        </ActionMenu>
      )}
    </Flex>
  )
  return (
    <DropTarget id={`${FOLDER_DROP_PREFIX}${folder.id}`} className="mx-2">
      {touchLayout ? (
        <ActionMenu
          type="contextual"
          trigger="manual"
          items={menuItems}
          opened={menuOpened}
          portalProps={{ target: menuPortalTarget }}
          onChange={handleMenuChange}
          position={isSmallScreen ? 'bottom-end' : 'bottom-start'}
          offset={0}
        >
          {header}
        </ActionMenu>
      ) : (
        header
      )}
      {empty && !collapsed && (
        <Text size="xs" c="chatbox-tertiary" pl={30} pb={6}>
          {t('Drag chats here')}
        </Text>
      )}
    </DropTarget>
  )
}
