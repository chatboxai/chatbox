import { areSessionsInSamePinGroup } from '@chatbox/core/utils/session-sort'
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
import NiceModal from '@ebay/nice-modal-react'
import { Button, Flex, Text } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { SessionMetaRecord } from '@shared/types'
import { IconArrowsMoveVertical, IconDots, IconGripVertical, IconLoader2 } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { type CSSProperties, type MutableRefObject, type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { rendererApplication } from '@/app/renderer-application'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSessionSwitchHintDigits } from '@/hooks/useSessionSwitchHints'
import platform from '@/platform'
import { reorderSessions } from '@/stores/session/crud'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu from '../ActionMenu'
import { ICON_SIZE, IconButton } from '../common/IconButton'
import Broom from '../icons/Broom'
import SessionItem from './SessionItem'

const useSessionList = () => rendererApplication.sessionHooks.useSessionList()

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

type SessionListItem =
  | { type: 'section'; id: string; label: string }
  | { type: 'session'; id: string; session: SessionMetaRecord }

function SessionListLoadingFooter() {
  return (
    <Flex justify="center" py="xs">
      <IconLoader2 size={16} className="animate-spin" style={{ color: 'var(--mantine-color-dimmed)' }} />
    </Flex>
  )
}

function SessionListSectionHeader(props: { label: string; testId?: string; children?: ReactNode }) {
  return (
    <Flex align="center" justify="space-between" mih={34} pl="md" pr="xs" pt={4} className="group/section">
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
          isSmallScreen
            ? undefined
            : 'opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[expanded=true]:opacity-100'
        }
      />
    </ActionMenu>
  )
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessionList()
  // Digits appear only while the switch modifier is held (see the hook); the
  // rows read them by session id, so a pinned row keeps its own key.
  const switchShortcutDigits = useSessionSwitchHintDigits()
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
    if (!event.over || !sortedSessions) {
      return
    }
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    if (activeId !== overId) {
      const oldIndex = sortedSessions.findIndex((s) => s.id === activeId)
      const newIndex = sortedSessions.findIndex((s) => s.id === overId)
      const activeSession = sortedSessions[oldIndex]
      const overSession = sortedSessions[newIndex]
      if (oldIndex < 0 || newIndex < 0 || !areSessionsInSamePinGroup(activeSession, overSession)) {
        return
      }
      await reorderSessions(oldIndex, newIndex)
    }
  }
  const onDragCancel = () => {
    setActiveDragId(null)
  }
  const activeDragSession = useMemo(
    () => sortedSessions?.find((session) => session.id === activeDragId),
    [activeDragId, sortedSessions]
  )
  const sortableSessionIds = useMemo(() => sortedSessions?.map((session) => session.id) ?? [], [sortedSessions])
  const displayItems = useMemo<SessionListItem[]>(() => {
    if (!sortedSessions) {
      return []
    }

    const pinnedSessions = sortedSessions.filter((session) => session.starred)
    const otherSessions = sortedSessions.filter((session) => !session.starred)
    if (sortedSessions.length === 0) {
      return []
    }

    return [
      ...(pinnedSessions.length > 0
        ? [
            { type: 'section' as const, id: 'section:pinned', label: t('Pinned') },
            ...pinnedSessions.map((session) => ({ type: 'session' as const, id: session.id, session })),
          ]
        : []),
      { type: 'section' as const, id: 'section:chats', label: t('Chats') },
      ...otherSessions.map((session) => ({ type: 'session' as const, id: session.id, session })),
    ]
  }, [sortedSessions, t])
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
          <Virtuoso
            className="sidebar-session-list"
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
                return item.id === 'section:chats' ? (
                  <SessionListSectionHeader label={item.label}>
                    <ChatsSectionMenu />
                  </SessionListSectionHeader>
                ) : (
                  <SessionListSectionHeader label={item.label} testId={TestId.sidebar.pinnedSection} />
                )
              }

              return (
                <SortableItem
                  id={item.session.id}
                  disabled={Boolean(isSmallScreen && !isReordering)}
                  dragLabel={`${t('Adjust order')}: ${item.session.name}`}
                  showDragHandle={Boolean(isSmallScreen && isReordering)}
                >
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${item.session.id}`}
                    session={item.session}
                    isReordering={Boolean(isSmallScreen && isReordering)}
                    onStartReordering={() => setIsReordering(true)}
                    switchShortcutDigit={switchShortcutDigits.get(item.session.id)}
                  />
                </SortableItem>
              )
            }}
          />
          <DragOverlay dropAnimation={null}>
            {activeDragSession ? (
              <div className="pointer-events-none scale-[1.02] rounded-md bg-chatbox-background-primary shadow-lg">
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
      className={disabled ? 'relative pb-1' : 'relative pb-1 cursor-grab active:cursor-grabbing'}
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
