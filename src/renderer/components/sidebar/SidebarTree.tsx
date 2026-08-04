import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  DragOverlay,
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
import { Box, Divider } from '@mantine/core'
import type { Folder } from '@shared/types/folder'
import { IconSparkles } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { type CSSProperties, type MutableRefObject, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { useSessionList } from '@/stores/chatStore'
import { useFolderList } from '@/stores/folderStore'
import { useUIStore } from '@/stores/uiStore'
import SidebarEmptyState from './SidebarEmptyState'
import SidebarFolderItem from './SidebarFolderItem'
import SidebarSectionLabel from './SidebarSectionLabel'
import SidebarSessionItem from './SidebarSessionItem'
import { applyTreeDrop, computeTreeDrop, PINNED_SECTION_ID, type SidebarFlatRow } from './treeDrop'
import { flattenSidebarTree, type SidebarTreeNode, selectPinnedSessions, useSidebarTree } from './useSidebarTree'

export interface SidebarTreeProps {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

type FlatRow =
  | { type: 'pinned-label'; id: 'pinned-label' }
  | { type: 'pinned-divider'; id: 'pinned-divider' }
  | { type: 'empty'; id: 'empty' }
  | { type: 'node'; id: string; node: SidebarTreeNode; pinned?: boolean }

/**
 * Virtualized, flat-rendered folder/session tree for the sidebar.
 *
 * The tree is built by {@link useSidebarTree} (recursive) and flattened via
 * {@link flattenSidebarTree} so Virtuoso can render a single scrollable list
 * while preserving nesting order and depth-based indentation.
 *
 * Layout (top to bottom):
 *   1. Pinned section (label + pinned sessions + divider) — only when pinned
 *      sessions exist.
 *   2. Folder/chat tree — recursive, only children of expanded folders.
 *   3. Empty state — when no tree nodes and no pinned sessions.
 *
 * Drag & drop wiring arrives in Phase 4; this component currently handles
 * click, expand/collapse, inline rename, and context menus.
 */
export default function SidebarTree(props: SidebarTreeProps) {
  const { t } = useTranslation()
  const { sessionMetaList } = useSessionList()
  const { folderList } = useFolderList()

  const expandedFolderIdsArray = useUIStore((s) => s.expandedFolderIds)
  const toggleExpandedFolderId = useUIStore((s) => s.toggleExpandedFolderId)
  const setExpandedFolderIds = useUIStore((s) => s.setExpandedFolderIds)

  const expandedFolderIds = useMemo(() => new Set(expandedFolderIdsArray), [expandedFolderIdsArray])

  const treeNodes = useSidebarTree({ sessions: sessionMetaList, folders: folderList, expandedFolderIds })
  const flatNodes = useMemo(() => flattenSidebarTree(treeNodes), [treeNodes])

  const pinnedSessions = useMemo(() => selectPinnedSessions(sessionMetaList), [sessionMetaList])

  const routerState = useRouterState()
  const selectedSessionId = useMemo(() => {
    const match = routerState.location.pathname.match(/^\/session\/(.+)$/)
    return match?.[1]
  }, [routerState.location.pathname])

  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = []
    if (pinnedSessions.length > 0) {
      out.push({ type: 'pinned-label', id: 'pinned-label' })
      for (const session of pinnedSessions) {
        out.push({
          type: 'node',
          id: session.id,
          node: { kind: 'session', id: session.id, session, depth: 0 },
          pinned: true,
        })
      }
      out.push({ type: 'pinned-divider', id: 'pinned-divider' })
    }
    for (const node of flatNodes) {
      out.push({ type: 'node', id: node.id, node })
    }
    if (out.length === 0) {
      out.push({ type: 'empty', id: 'empty' })
    }
    return out
  }, [pinnedSessions, flatNodes])

  // Flat projection used by the pure DnD resolver (computeTreeDrop). Pinned
  // sessions share their real session id so draggedId matches; their parentId
  // is null (root) and starred is conveyed via the per-row `pinned` flag → the
  // resolver receives draggedStarred separately at drag start.
  const dropRows = useMemo<SidebarFlatRow[]>(() => {
    const out: SidebarFlatRow[] = []
    for (const session of pinnedSessions) {
      out.push({ id: session.id, kind: 'session', depth: 0, parentId: null, sortOrder: session.sortOrder })
    }
    for (const node of flatNodes) {
      if (node.kind === 'folder') {
        out.push({
          id: node.id,
          kind: 'folder',
          depth: node.depth,
          parentId: node.folder.parentId ?? null,
          sortOrder: node.folder.sortOrder,
        })
      } else {
        out.push({
          id: node.id,
          kind: 'session',
          depth: node.depth,
          parentId: node.session.parentId ?? null,
          sortOrder: node.session.sortOrder,
        })
      }
    }
    return out
  }, [pinnedSessions, flatNodes])

  // Ids of every draggable node row (folders + sessions, pinned + tree).
  const sortableIds = useMemo(
    () => rows.filter((row) => row.type === 'node').map((row) => (row as { id: string }).id),
    [rows]
  )

  const onToggleFolder = useCallback(
    (id: string) => {
      toggleExpandedFolderId(id)
    },
    [toggleExpandedFolderId]
  )

  // Keep expanded ids in sync: drop ids for folders that no longer exist so the
  // persisted set does not grow unbounded across folder deletions.
  const folderIdSet = useMemo(() => new Set((folderList ?? []).map((folder) => folder.id)), [folderList])
  useMemo(() => {
    if (expandedFolderIdsArray.some((id) => !folderIdSet.has(id))) {
      setExpandedFolderIds(expandedFolderIdsArray.filter((id) => folderIdSet.has(id)))
    }
  }, [expandedFolderIdsArray, folderIdSet, setExpandedFolderIds])

  // --- Drag & drop (Phase 4) -----------------------------------------------------
  const isSmallScreen = useIsSmallScreen()
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 10 } })
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  const sensors = useSensors(...(!isSmallScreen || isReordering ? [touchSensor] : []), mouseSensor, keyboardSensor)

  const activeDragRow = useMemo(
    () =>
      rows.find((row) => row.type === 'node' && row.id === activeDragId) as
        | { node: SidebarTreeNode; pinned?: boolean }
        | undefined,
    [activeDragId, rows]
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }, [])
  const onDragCancel = useCallback(() => setActiveDragId(null), [])
  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null)
      const activeId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : null
      if (!overId) return
      const activeRow = rows.find((r) => r.type === 'node' && r.id === activeId)
      const result = computeTreeDrop({
        rows: dropRows,
        draggedId: activeId,
        overId,
        draggedStarred: Boolean(activeRow?.type === 'node' && activeRow.pinned),
        folders: folderList ?? [],
      })
      if (result) {
        await applyTreeDrop(result)
      }
    },
    [dropRows, folderList, rows]
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
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
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
          data={rows}
          computeItemKey={(_index, row) => row.id}
          scrollerRef={(ref) => {
            if (ref instanceof HTMLDivElement) {
              props.sessionListViewportRef.current = ref
            }
          }}
          itemContent={(_index, row) => {
            if (row.type === 'pinned-label') {
              return (
                <PinnedSectionDroppable>
                  <SidebarSectionLabel
                    icon={<IconSparkles size={13} className="text-chatbox-tertiary" />}
                    label={t('Pinned Chats')}
                  />
                </PinnedSectionDroppable>
              )
            }
            if (row.type === 'pinned-divider') {
              return (
                <Box px="sm" py={4}>
                  <Divider />
                </Box>
              )
            }
            if (row.type === 'empty') {
              return <SidebarEmptyState />
            }

            const { node } = row
            const sortableDisabled = Boolean(isSmallScreen && !isReordering)
            return (
              <SortableTreeRow id={row.id} disabled={sortableDisabled}>
                {node.kind === 'folder' ? (
                  <SidebarFolderItem
                    folder={node.folder}
                    depth={node.depth}
                    expanded={expandedFolderIds.has(node.folder.id)}
                    showTreeLine={node.depth > 0}
                    onToggle={() => onToggleFolder(node.folder.id)}
                    onRename={(name) => {
                      void updateFolderName(node.folder.id, name)
                    }}
                    onCreateChat={() => {
                      void createChatInFolder(node.folder.id)
                    }}
                    onCreateSubfolder={() => {
                      void createSubfolder(node.folder.id)
                    }}
                    onDelete={() => {
                      void deleteFolderById(node.folder.id)
                    }}
                  />
                ) : (
                  <SidebarSessionItem
                    session={node.session}
                    depth={node.depth}
                    selected={selectedSessionId === node.session.id}
                    showTreeLine={node.depth > 0}
                    isReordering={Boolean(isSmallScreen && isReordering)}
                    onStartReordering={() => setIsReordering(true)}
                  />
                )}
              </SortableTreeRow>
            )
          }}
        />
      </SortableContext>
      <DragOverlay>
        {activeDragRow ? (
          <div className="pointer-events-none">
            {activeDragRow.node.kind === 'folder' ? (
              <SidebarFolderItem
                folder={activeDragRow.node.folder}
                depth={activeDragRow.node.depth}
                expanded={expandedFolderIds.has(activeDragRow.node.folder.id)}
                showTreeLine={activeDragRow.node.depth > 0}
                onToggle={() => {}}
                onRename={() => {}}
                onCreateChat={() => {}}
                onCreateSubfolder={() => {}}
                onDelete={() => {}}
              />
            ) : (
              <SidebarSessionItem
                session={activeDragRow.node.session}
                depth={activeDragRow.node.depth}
                selected={selectedSessionId === activeDragRow.node.session.id}
                showTreeLine={activeDragRow.node.depth > 0}
              />
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** Wraps a draggable row with @dnd-kit sortable transforms. */
function SortableTreeRow(props: { id: string; disabled?: boolean; children: React.ReactNode }) {
  const { id, disabled = false, children } = props
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative"
      {...(!disabled ? attributes : {})}
      {...(!disabled ? listeners : {})}
    >
      {children}
    </div>
  )
}

/** Makes the pinned section header a drop target for pinning sessions. */
function PinnedSectionDroppable(props: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: PINNED_SECTION_ID })
  return (
    <div ref={setNodeRef} className={isOver ? 'bg-chatbox-background-gray-secondary rounded-sm' : undefined}>
      {props.children}
    </div>
  )
}

import { updateSession } from '@/stores/chatStore'
// Local lazy imports to avoid pulling the store action modules into the
// component's top-level graph before they're needed. They resolve to the same
// singletons used elsewhere.
import { deleteFolder, updateFolder } from '@/stores/folderStore'
import { createEmpty } from '@/stores/session/crud'

async function updateFolderName(id: string, name: string) {
  await updateFolder(id, { name })
}

async function deleteFolderById(id: string) {
  // MVP: only allow deletion when the folder has no children. The confirm modal
  // text in SidebarFolderItem explains this; callers should check emptiness
  // before invoking. Here we delegate straight to the store.
  await deleteFolder(id)
}

async function createChatInFolder(parentId: string) {
  // TODO(sidebar-phase5): createEmpty should accept parentId. For now, create a
  // top-level chat and then move it under the folder via session metadata.
  const session = await createEmpty('chat')
  await updateSession(session.id, { parentId })
}

async function createSubfolder(parentId: string) {
  // Prompt for a subfolder name via the shared CreateFolderModal, pre-seeded
  // under the given parent. On confirm, expand the parent so the new subfolder
  // is immediately visible in the tree.
  const folder = await NiceModal.show<Folder | undefined>('create-folder', { parentId })
  if (folder) {
    const { uiStore } = await import('@/stores/uiStore')
    const current = uiStore.getState().expandedFolderIds
    if (!current.includes(parentId)) {
      uiStore.getState().toggleExpandedFolderId(parentId)
    }
  }
}
