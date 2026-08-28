import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragStartEvent,
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
import { Button, Flex, Text } from '@mantine/core'
import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { IconArrowsMoveVertical, IconGripVertical, IconLoader2 } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { type CSSProperties, type MutableRefObject, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { useFolders, useSessionList } from '@/stores/chatStore'
import { reorderSessions } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import FolderHeader from './FolderHeader'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

type SessionListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'folder'; id: string; folder: SessionFolder }
  | { type: 'session'; id: string; session: SessionMetaRecord }

function SessionListLoadingFooter() {
  return (
    <Flex justify="center" py="xs">
      <IconLoader2 size={16} className="animate-spin" style={{ color: 'var(--mantine-color-dimmed)' }} />
    </Flex>
  )
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessionList()
  const { folders } = useFolders()
  const collapsedFolders = useUIStore((s) => s.collapsedFolders)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const isSmallScreen = useIsSmallScreen()
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
  const sensors = useSensors(...(!isSmallScreen || isReordering ? [touchSensor] : []), mouseSensor, keyboardSensor)
  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }
  const onDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over) {
      return
    }
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    // Cross-group protection (pinned vs folder vs unfiled) lives inside reorderSessions.
    if (activeId !== overId) {
      await reorderSessions(activeId, overId)
    }
  }
  const onDragCancel = () => {
    setActiveDragId(null)
  }
  const activeDragSession = useMemo(
    () => sortedSessions?.find((session) => session.id === activeDragId),
    [activeDragId, sortedSessions]
  )
  const displayItems = useMemo<SessionListItem[]>(() => {
    if (!sortedSessions) {
      return []
    }

    const pinnedSessions = sortedSessions.filter((session) => session.starred)
    const folderedSessions = sortedSessions.filter((session) => !session.starred && session.folderId)
    const chatSessions = sortedSessions.filter((session) => !session.starred && !session.folderId)
    const hasGroupHeaders = pinnedSessions.length > 0 || folders.length > 0

    const items: SessionListItem[] = []
    if (pinnedSessions.length > 0) {
      items.push({ type: 'section', id: 'section:pinned', label: t('Pinned') })
      pinnedSessions.forEach((session) => items.push({ type: 'session', id: session.id, session }))
    }
    folders.forEach((folder) => {
      items.push({ type: 'folder', id: `folder:${folder.id}`, folder })
      if (collapsedFolders[folder.id] !== true) {
        folderedSessions
          .filter((session) => session.folderId === folder.id)
          .forEach((session) => items.push({ type: 'session', id: session.id, session }))
      }
    })
    if (chatSessions.length > 0) {
      if (hasGroupHeaders) {
        items.push({ type: 'section', id: 'section:chats', label: t('Chats') })
      }
      chatSessions.forEach((session) => items.push({ type: 'session', id: session.id, session }))
    }
    return items
  }, [sortedSessions, folders, collapsedFolders, t])
  const sortableSessionIds = useMemo(
    () => displayItems.filter((item) => item.type === 'session').map((item) => item.id),
    [displayItems]
  )
  const routerState = useRouterState()
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const virtuosoComponents = useMemo(
    () =>
      hasNextPage
        ? {
            Footer: SessionListLoadingFooter,
          }
        : {},
    [hasNextPage]
  )

  return (
    <DndContext
      modifiers={[restrictToVerticalAxis]}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {sortedSessions && (
        <SortableContext items={sortableSessionIds} strategy={verticalListSortingStrategy}>
          {isSmallScreen && isReordering && (
            <Flex
              align="center"
              justify="space-between"
              mx="xs"
              mb={2}
              px="xs"
              py={6}
              className="rounded-sm bg-chatbox-background-gray-secondary"
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
          <Virtuoso
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
            data={displayItems}
            computeItemKey={(_index, item) => item.id}
            scrollerRef={(ref) => {
              if (ref instanceof HTMLDivElement) {
                props.sessionListViewportRef.current = ref
              }
            }}
            endReached={onEndReached}
            components={virtuosoComponents}
            itemContent={(_index, item) => {
              if (item.type === 'section') {
                return (
                  <Text px="md" pt="sm" pb={4} size="xs" fw={600} c="chatbox-tertiary">
                    {item.label}
                  </Text>
                )
              }

              if (item.type === 'folder') {
                return <FolderHeader folder={item.folder} />
              }

              return (
                <SortableItem
                  id={item.session.id}
                  disabled={Boolean(isSmallScreen && !isReordering)}
                  showDragHandle={Boolean(isSmallScreen && isReordering)}
                  dragHandleLabel={t('Adjust order') || undefined}
                >
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${item.session.id}`}
                    session={item.session}
                    isReordering={Boolean(isSmallScreen && isReordering)}
                    onStartReordering={() => setIsReordering(true)}
                  />
                </SortableItem>
              )
            }}
          />
          <DragOverlay dropAnimation={null}>
            {activeDragSession ? (
              <div className="pointer-events-none">
                <SessionItem
                  selected={routerState.location.pathname === `/session/${activeDragSession.id}`}
                  session={activeDragSession}
                  isReordering={Boolean(isSmallScreen && isReordering)}
                />
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
  children?: React.ReactNode
  disabled?: boolean
  showDragHandle?: boolean
  dragHandleLabel?: string
}) {
  const { id, children, disabled = false, showDragHandle = false, dragHandleLabel } = props
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform, transition } = useSortable({
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
      className="relative pb-1"
      {...(!disabled && !showDragHandle ? attributes : {})}
      {...(!disabled && !showDragHandle ? listeners : {})}
    >
      {children}
      {showDragHandle && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={dragHandleLabel}
          className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 touch-none items-center justify-center rounded-sm border-0 bg-transparent text-chatbox-tertiary active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={18} />
        </button>
      )}
    </div>
  )
}
