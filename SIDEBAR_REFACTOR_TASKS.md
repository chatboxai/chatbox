# Sidebar Refactor — Detailed Task List

> Derived from `SIDEBAR_REFACTOR_PLAN.md`. Each task includes the files to change, expected outcome, and acceptance criteria. All identifiers and i18n keys must remain in English.

---

## Legend

| Prefix | Meaning |
|--------|---------|
| `[ADD]` | Create new file / component / type / table |
| `[MOD]` | Modify existing file |
| `[DEL]` | Delete or deprecate existing file |
| `[TEST]` | Add or update tests |
| `[DOCS]` | Add inline comments or update external docs |

---

## Phase 1 — Data Foundation

### 1.1 Shared folder types

**[ADD] `src/shared/types/folder.ts`**
- Define `FolderSchema` with fields: `id`, `type: 'folder'`, `name`, `parentId: string | null`, `sortOrder`, `createdAt`.
- Export inferred `Folder` type.
- Export `FolderArraySchema` for validation.

**[MOD] `src/shared/types/index.ts` or `src/shared/types.ts`**
- Re-export `Folder`, `FolderSchema` so consumers can import from `@shared/types`.

**[MOD] `src/shared/types/session.ts`**
- Add `parentId: z.string().optional()` to `SessionSchema`.
- Add `parentId: true` to `SessionMetaSchema.pick(...)` so `SessionMeta` and `SessionMetaRecord` include it.
- Ensure `SessionMetaRecordSchema` still validates correctly.

### 1.2 Folder repository port

**[ADD] `src/shared/ports/folder-repository.ts`**
- Define `FolderRepositoryPort` interface:
  - `create(record: Folder): Promise<void>`
  - `createMany(records: Folder[]): Promise<void>`
  - `update(id: string, updates: Partial<Folder>): Promise<Folder | null>`
  - `delete(id: string): Promise<void>`
  - `deleteMany(ids: string[]): Promise<void>`
  - `getById(id: string): Promise<Folder | null>`
  - `getAll(): Promise<Folder[]>`
  - `getChildren(parentId: string | null): Promise<Folder[]>`
  - `clear(): Promise<void>`

**[MOD] `src/shared/ports/index.ts`**
- Re-export `FolderRepositoryPort`.

### 1.3 IndexedDB folder storage

**[ADD] `src/renderer/storage/FolderStorage.ts`**
- Create `FolderStorage` interface extending `FolderRepositoryPort` with `initialize(): Promise<void>`.
- Implement `IndexedDBFolderStorage`:
  - Database name `chatbox-folders`.
  - Object store `records` keyed by `id`.
  - Indexes: `parentId`, `sortOrder`, `parentSortOrder` as compound `[parentId, sortOrder]`.
  - Migration note: additive-only schema, handle `VersionError` by reopening without version.
- Sort children by `sortOrder` descending inside `getChildren`.

### 1.4 SQLite folder storage (mobile)

**[ADD] `src/renderer/storage/SQLiteFolderStorage.ts`**
- Implement `FolderStorage` using `@capacitor-community/sqlite`.
- Table `folders`:
  - `id TEXT PRIMARY KEY NOT NULL`
  - `name TEXT NOT NULL`
  - `parent_id TEXT`
  - `sort_order REAL NOT NULL`
  - `created_at INTEGER NOT NULL`
- Add `recordToRow` / `rowToRecord` helpers.
- Implement all `FolderRepositoryPort` methods.

### 1.5 Platform folder storage factory

**[MOD] `src/renderer/platform/interfaces.ts`**
- Add `getFolderStorage(): Promise<FolderStorage>` to the platform interface.

**[MOD] `src/renderer/platform/desktop_platform.ts`**
- Implement `getFolderStorage()` returning `IndexedDBFolderStorage`.

**[MOD] `src/renderer/platform/web_platform.ts`**
- Implement `getFolderStorage()` returning `IndexedDBFolderStorage`.

**[MOD] `src/renderer/platform/mobile_platform.ts`**
- Implement `getFolderStorage()` returning `SQLiteFolderStorage`.

**[MOD] `src/renderer/platform/test_platform.ts`**
- Add stub `getFolderStorage()` returning an in-memory implementation or the IndexedDB one.

### 1.6 Folder store (React Query)

**[ADD] `src/renderer/stores/folderStore.ts`**
- Define query key `QueryKeys.Folders = ['folders']`.
- `useFolderList()` hook returning `{ folderList, refetch, ... }`.
- Imperative helpers:
  - `listFolders(): Promise<Folder[]>`
  - `createFolder(name, parentId?): Promise<Folder>`
  - `updateFolder(id, updates): Promise<Folder | null>`
  - `deleteFolder(id): Promise<void>`
  - `moveFolder(id, parentId, sortOrder): Promise<void>`
- Cache updater `updateFolderListData(updater)` following the same flattened-page pattern as `updateSessionListData`.

### 1.7 Build number infrastructure

**[MOD] `electron.vite.config.ts`**
- Define `process.env.CHATBOX_BUILD_NUMBER` from `process.env.CHATBOX_BUILD_NUMBER || packageJson.version`.

**[MOD] `vite.config.web.ts`**
- Define `process.env.CHATBOX_BUILD_NUMBER` similarly.

**[MOD] `src/main/main.ts`**
- Add IPC handler: `ipcMain.handle('getBuildNumber', () => process.env.CHATBOX_BUILD_NUMBER || app.getVersion())`.

**[MOD] `src/renderer/platform/interfaces.ts`**
- Add `getBuildNumber(): Promise<string>`.

**[MOD] `src/renderer/platform/desktop_platform.ts`**
- Implement `getBuildNumber()` via `ipc.invoke('getBuildNumber')` with cache.

**[MOD] `src/renderer/platform/web_platform.ts`**
- Implement `getBuildNumber()` returning `process.env.CHATBOX_BUILD_NUMBER || ''`.

**[MOD] `src/renderer/platform/mobile_platform.ts`**
- Implement `getBuildNumber()` using `App.getInfo()` build number or env fallback.

**[MOD] `src/renderer/platform/test_platform.ts`**
- Add stub `getBuildNumber()`.

**[MOD] `src/renderer/hooks/useVersion.ts`**
- Add `buildNumber` field.
- Fetch build number from `platform.getBuildNumber()` alongside version.
- Export `useBuildNumber()` convenience hook if useful.

### 1.8 i18n keys (English identifiers, optional localized values)

**[MOD] `src/renderer/i18n/locales/en/translation.json`**
- Add keys:
  - `"New Folder"`
  - `"New Chat"`
  - `"Create Chat"`
  - `"Pinned Chats"`
  - `"Build Number"`
  - `"Move to Folder"`
  - `"Move to Root"`
  - `"Rename Folder"`
  - `"Delete Folder"`
  - `"Create Subfolder"`
  - `"New Chat in Folder"`
  - `"Collapse Folder"`
  - `"Expand Folder"`
  - `"No chats yet"`
  - `"No folders yet"`

**[MOD] `src/renderer/i18n/locales/*/translation.json` for all other locales**
- Add same keys with English fallback values. Translators can localize later.

### 1.9 Phase 1 acceptance

- `pnpm run check` passes.
- `pnpm run lint` passes.
- `Folder` type and storage can be imported without errors.
- `useVersion().buildNumber` returns a string in dev builds.

---

## Phase 2 — Sidebar Shell

### 2.1 Move sidebar component

**[ADD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Copy the current `src/renderer/Sidebar.tsx` content as the starting point.
- Keep: resize logic, mobile safe area, SwipeableDrawer, update banner, i18n, version hook.

**[MOD] `src/renderer/Sidebar.tsx`**
- Replace content with a single re-export:
  ```ts
  export { default } from './components/sidebar/Sidebar'
  ```
- Keep this file for backward compatibility and to avoid breaking existing imports.

**[MOD] `src/renderer/routes/__root.tsx`**
- Change `import Sidebar from '@/Sidebar'` to `import Sidebar from '@/components/sidebar/Sidebar'`.
- Remove the old re-export if desired after full migration.

### 2.2 New header component

**[ADD] `src/renderer/components/sidebar/SidebarHeader.tsx`**
- Props:
  - `onSearchClick(): void`
  - `onCreateFolderClick(): void`
  - `onCreateChatClick(): void`
  - `onCollapseClick(): void`
  - `version: string`
  - `isSmallScreen: boolean`
- Layout:
  - Left: Chatbox logo + name (clickable to `/about`).
  - Right: Search icon, New Folder icon, New Chat icon, Collapse icon.
- Icon specifications (match wireframe):
  - Search: `IconSearch`
  - New Folder: `IconFolderPlus` (folder glyph + "+" overlay)
  - New Chat: `IconMessagePlus` or `IconMessage2Plus` (chat glyph + "+" overlay)
  - Collapse: `IconLayoutSidebarRightCollapse` or `IconArrowBarRight` (right arrow `→`)
- Use Mantine `Tooltip` with `openDelay={1000}` matching current style.
- On mobile, optionally show version next to the logo as today.

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Replace inline header JSX with `<SidebarHeader ... />`.
- Remove the archive/clear-list icon and its `NiceModal.show('clear-session-list')` call.
- Remove the bottom text-based nav links (`My Copilots`, `Settings`, `Help`, `About`) from the main stack.

### 2.3 New footer component

**[ADD] `src/renderer/components/sidebar/SidebarFooter.tsx`**
- Props:
  - `buildNumber: string`
  - `hasUpdate: boolean`
  - `onSettingsClick(): void`
  - `onHelpClick(): void`
  - `onAboutClick(): void`
  - `isSmallScreen: boolean`
- Layout:
  - Desktop: horizontal icon row with labels on hover.
  - Mobile: compact icon row.
  - About icon shows build number as text next to it.
  - About icon displays a dot indicator when `hasUpdate` is true.
- Use existing icons: `IconSettingsFilled`, `IconHelpCircle`, `IconInfoCircle`.

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Replace bottom nav JSX with `<SidebarFooter ... />`.
- Pass `versionHook.buildNumber` and update state.
- Keep `navigateToSettings()` for settings click.
- Help click navigates to `/guide`.
- About click navigates to `/about` and closes sidebar on mobile.

### 2.4 Simplify bottom buttons

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Remove the "New Chat" and "Create Image" full-width buttons above the footer.
- Move "New Chat" action into the header icon.
- Move "Create Image" out of sidebar entirely; leave a TODO comment for the new location (main toolbar or new-chat menu).

### 2.5 Phase 2 acceptance

- Sidebar renders new header and footer.
- Header icons fire the correct callbacks.
- Footer About icon shows build number and navigates to `/about`.
- No regression on resize, mobile drawer, or update banner.

---

## Phase 3 — Folder Tree

### 3.1 Tree state hook

**[ADD] `src/renderer/components/sidebar/useSidebarTree.ts`**
- Inputs:
  - `sessions: SessionMetaRecord[] | undefined`
  - `folders: Folder[] | undefined`
  - `expandedFolderIds: Set<string>`
- Output: `SidebarTreeNode[]`:
  ```ts
  type SidebarTreeNode =
    | { kind: 'folder'; id: string; folder: Folder; children: SidebarTreeNode[]; depth: number }
    | { kind: 'session'; id: string; session: SessionMetaRecord; depth: number }
  ```
- Rules:
  - Pinned sessions are not part of the tree (handled separately).
  - Top-level items have `parentId === undefined || parentId === null`.
  - Sort each group by `sortOrder` descending.
  - Only include children of expanded folders.
  - Memoize with `useMemo`.

### 3.2 Tree container

**[ADD] `src/renderer/components/sidebar/SidebarTree.tsx`**
- Props:
  - `nodes: SidebarTreeNode[]`
  - `selectedSessionId: string | undefined`
  - `expandedFolderIds: Set<string>`
  - `onToggleFolder(id): void`
  - `onCreateChatInFolder(parentId?): void`
  - `onCreateSubfolder(parentId?): void`
  - `onRenameFolder(folder): void`
  - `onDeleteFolder(folder): void`
  - `onMoveSession(session, targetFolderId | null): void`
  - `onMoveFolder(folder, targetFolderId | null): void`
  - `onSessionClick(session): void`
- Render a flat list (not recursive nested DOM) so Virtuoso can be used.
- Each node renders with left padding based on `depth * indentPx`.
- Use `react-virtuoso` for performance if node count is large.
- Empty state: if `nodes.length === 0`, show `<SidebarEmptyState />`.

### 3.3 Folder row

**[ADD] `src/renderer/components/sidebar/SidebarFolderItem.tsx`**
- Props:
  - `folder: Folder`
  - `depth: number`
  - `expanded: boolean`
  - `isDropTarget: boolean`
  - `showTreeLine?: boolean` (default `true` for children of expanded folders)
  - `onToggle(): void`
  - `onRename(name): void`
  - `onCreateChat(): void`
  - `onCreateSubfolder(): void`
  - `onDelete(): void`
  - `onMoveTo(targetFolderId | null): void`
- Visual:
  - Chevron icon: `IconChevronRight` rotated when expanded.
  - Folder icon: `IconFolder` / `IconFolderOpen`.
  - Name text, inline editable on rename.
  - Hover actions (desktop): small action buttons for new chat / new subfolder / more menu.
  - Mobile: long-press opens context menu.
  - **Tree-line:** when `showTreeLine` is true, render a thin vertical line (`1px`, `currentColor / opacity 0.2`) on the left edge, aligned to the folder icon's horizontal center.
- Styling:
  - Match current `SessionItem` colors (`chatbox-secondary`, hover background).
  - Selected/focused states for keyboard navigation.
  - Indent by `depth * 16px` from the left edge.

**[ADD] `src/renderer/components/sidebar/SidebarSessionItem.tsx`**
- Props:
  - `session: SessionMetaRecord`
  - `depth: number`
  - `selected: boolean`
  - `showTreeLine?: boolean`
  - `isReordering?: boolean`
  - `onStartReordering?(): void`
  - `dragHandleProps?`
- Render existing `SessionItem` but pass `depth` for left padding and `showTreeLine` for the vertical line.
- Add context menu items:
  - Pin/Unpin
  - Archive
  - Move to Folder (submenu of root folders)
  - Rename (future)
- Keep mobile long-press behavior.
- **Tree-line:** when `showTreeLine` is true, render the same thin vertical line as folder rows for consistent indentation rhythm.

### 3.4 Session row wrapper

**[ADD] `src/renderer/components/sidebar/SidebarSessionItem.tsx`**
- Props:
  - `session: SessionMetaRecord`
  - `depth: number`
  - `selected: boolean`
  - `showTreeLine?: boolean`
  - `isReordering?: boolean`
  - `onStartReordering?(): void`
  - `dragHandleProps?`
- Render existing `SessionItem` but pass `depth` for left padding and `showTreeLine` for the vertical line.
- Add context menu items:
  - Pin/Unpin
  - Archive
  - Move to Folder (submenu of root folders)
  - Rename (future)
- Keep mobile long-press behavior.
- **Tree-line:** when `showTreeLine` is true, render the same thin vertical line as folder rows for consistent indentation rhythm.

### 3.5 Empty state

**[ADD] `src/renderer/components/sidebar/SidebarEmptyState.tsx`**
- Show a centered illustration/icon and text when the tree is empty.
- Text: `"No chats yet"` with a subtext prompting the user to create a chat or folder.
- Use `chatbox-tertiary` color.

**[ADD] `src/renderer/components/sidebar/SidebarSectionLabel.tsx`**
- Props:
  - `icon?: ReactNode` (optional leading icon, e.g., `IconSparkles` for Pinned Chats)
  - `label: string`
- Renders a small uppercase/medium-weight text label used as section header (e.g., "Pinned Chats").
- Spacing matches current `SectionLabel` style in `SessionList.tsx`.

### 3.6 Pinned section

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Add pinned section before the tree:
  ```tsx
  {pinnedSessions.length > 0 && (
    <>
      <SidebarSectionLabel icon={<IconSparkles />} label={t('Pinned Chats')} />
      {pinnedSessions.map(s => (
        <SidebarSessionItem session={s} depth={0} showTreeLine />
      ))}
      <Divider />
    </>
  )}
  ```
- Pinned sessions come from `SessionMetaRecord[]` filtered by `starred === true`.
- Pinned items ignore `parentId`.
- Pinned chats are draggable only within the pinned section (no cross-area drops into tree or vice versa).
- Pinned rows render a thin vertical tree-line on the left for visual rhythm (matches wireframe's left `│` lines next to Chat 03 / Chat 04).
- When `pinnedSessions.length === 0`, render nothing — label, items, and divider are all removed.

### 3.6.1 SessionList removal

**[MOD] `src/renderer/components/session/SessionList.tsx`**
- Stop importing `SessionList` from `Sidebar.tsx`.
- File remains on disk for potential future reuse but becomes dead code.
- Add a `// TODO: deprecate or refactor for other surfaces` header comment.

**[TEST] Update `src/renderer/components/session/` tests**
- Remove or skip `SessionList` tests if they become orphaned.
- Ensure `SessionItem` tests still pass with new `parentId` prop.

### 3.7 Inline rename / create folder

**[MOD] `src/renderer/components/sidebar/SidebarFolderItem.tsx`**
- Add local editing state.
- On create-folder header action, insert a temporary editable folder row at the top level with default name `"New Folder"`.
- On blur/Enter, call `onRename` or create the folder via `folderStore.createFolder`.
- On Escape, cancel.

### 3.7.1 Folder context menu (mobile + desktop)

**[MOD] `src/renderer/components/sidebar/SidebarFolderItem.tsx`**
- Right-click (desktop) / long-press (mobile) opens a context menu with:
  - `New Chat in Folder` → calls `onCreateChat()`.
  - `Create Subfolder` → calls `onCreateSubfolder()`.
  - `Rename Folder` → enters inline editing mode.
  - `Move to Folder` → opens a submenu listing all other folders (excluding self and descendants to prevent cycles).
  - `Move to Root` (only when folder is currently nested).
  - `Delete Folder` → opens confirmation modal (see 5.5).
- Use existing `ActionMenu` component for consistency.

**[MOD] `src/renderer/components/sidebar/SidebarSessionItem.tsx`**
- Right-click (desktop) / long-press (mobile) opens a context menu with:
  - `Pin` / `Unpin`
  - `Move to Folder` (submenu of root folders + current parent highlighted).
  - `Move to Root`
  - `Archive`
  - `Adjust order` (mobile reorder mode entry point).

### 3.8 Expand/collapse persistence

**[MOD] `src/renderer/stores/uiStore.ts`**
- Add state:
  - `expandedFolderIds: Set<string>`
  - `toggleExpandedFolderId(id): void`
  - `setExpandedFolderIds(ids): void`
- Persist to `localStorage` / settings store so it survives restart.

### 3.9 Phase 3 acceptance

- Folders and sessions render as a tree.
- Folders expand/collapse and persist state.
- Pinned section appears only when pinned sessions exist and is separated by a divider.
- Empty state shows when no tree items.
- Folder inline rename/create works.

---

## Phase 4 — Drag & Drop

### 4.1 Tree DnD context

**[ADD] `src/renderer/components/sidebar/SidebarDndContext.tsx`**
- Wrap `SidebarTree` with `@dnd-kit/core` `DndContext`.
- Configure sensors: mouse, touch (with delay/tolerance matching current), keyboard.
- Use a collision detection strategy that supports both reordering between items and dropping onto folders.
- Provide drag overlay renderer using `SidebarFolderItem` / `SidebarSessionItem`.

### 4.2 Sortable tree rows

**[MOD] `src/renderer/components/sidebar/SidebarTree.tsx`**
- Wrap each row in `useSortable({ id: node.id, data: { node } })`.
- Disable sorting on non-reorderable states if needed.
- Provide drag handle only in mobile reorder mode (same pattern as current `SessionList`).

### 4.3 Drop indicator

**[ADD] `src/renderer/components/sidebar/SidebarDropIndicator.tsx`**
- Render a horizontal line between rows or a folder highlight when dragging.
- Props: `position: 'before' | 'after' | 'inside'`, `isFolder: boolean`.

### 4.4 Drag action helpers

**[ADD] `src/renderer/stores/sessionTreeActions.ts`**
- `moveSessionToFolder(sessionId, targetFolderId | null): Promise<void>`
- `moveFolderToFolder(folderId, targetFolderId | null): Promise<void>`
- `reorderTreeItem(itemId, newParentId, beforeId?, afterId?): Promise<void>`
- `pinAndMoveToPinned(sessionId): Promise<void>` — sets `starred = true`, `parentId = null`.
- `unpinAndMove(sessionId, targetFolderId | null): Promise<void>` — sets `starred = false`, sets `parentId`.
- Compute new fractional `sortOrder` using neighbors.
- Update both `SessionMetaRecord` and `Folder` caches.
- Prevent cycles (e.g., dropping a folder onto its own descendant) by walking the folder tree before applying.

**[MOD] `src/renderer/stores/session/crud.ts`**
- Update `reorderSessions` to accept optional `parentId` and handle cross-folder moves.
- Keep backward-compatible signature for existing callers.

### 4.5 DnD event handler in Sidebar

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Implement `handleDragEnd(event)`:
  - Determine drop target kind (`session`, `folder`, or gap between items).
  - Detect drag source area (`pinned` vs `tree`) via `data.sourceArea` set in the row component.
  - If source is pinned and target is tree → call `unpinAndMove(sessionId, targetParentId)`.
  - If source is tree and target is pinned → call `pinAndMoveToPinned(sessionId)`.
  - If both in tree → call `sessionTreeActions` helpers.
  - Show toast on error.
- Implement `handleDragStart`, `handleDragCancel`, `handleDragOver` for drop indicator updates.
- Reject cross-area drags that are not in the above allowed transitions (snap back).

### 4.5.1 Pinned area drag rules

- Sessions dragged from tree → pinned: set `starred = true`, `parentId = null`, append to pinned section.
- Sessions dragged from pinned → tree: set `starred = false`, set `parentId = targetParentId`, append to target folder.
- Sessions dragged within pinned section: re-sort by `sortOrder` only (same pin group rule as today).
- Sessions dragged within tree: covered by `reorderTreeItem`.
- Folders cannot be dragged into or out of the pinned section (pinned is sessions-only).

### 4.6 Mobile reorder mode

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Keep a `isReordering` state for mobile.
- Add a "Reorder" entry in the mobile context menu for sessions/folders.
- Show drag handles only while reordering (same UX as current `SessionList`).

### 4.7 Phase 4 acceptance

- Sessions can be reordered inside a folder.
- Sessions can be moved between folders and to root.
- Folders can be reordered among siblings.
- Folders can be nested inside other folders.
- Cyclic folder drops are rejected with visual feedback.
- Mobile reorder mode works.

> **Ek (Kısım 1):** `ROOT_DROP_ID` artık UI'ya bağlı (trailing `RootDropSpacer` +
> empty-state wrapper). Root'a taşıma her zaman mümkün (son satır klasör olsa bile).
> Kapsamlı senaryo testleri eklendi (klasör üst/alt dizine, chat üste/alta, boş
> klasöre drop, cycle, propagation). Bkz. `SIDEBAR_REFACTOR_NOTES.md` → Phase 5 (Kısım 1).
> Hâlâ açık: **drop indicator çizgileri** (4.3 — Visual Polish, görsel only; resolver mantığı hazır).

---

## Phase 5 — Integration & Polish

### 5.1 Session creation with parent

**[MOD] `src/renderer/stores/session/crud.ts`**
- Update `createEmpty` to accept optional `parentId`.
- When creating a chat from a folder row or inside a folder, pass `parentId`.

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Header "New Chat" creates a top-level chat (`parentId = null`).
- Folder row "New Chat" creates a chat with `parentId = folder.id`.

### 5.2 Archive behavior

**[MOD] `src/renderer/components/session/SessionItem.tsx`**
- When archiving a session that has a `parentId`, keep `parentId` in metadata but set `archivedAt`.
- Archived sessions no longer appear in the sidebar tree.

**[MOD] `src/renderer/modals/ClearSessionList.tsx` (optional)**
- Keep modal but ensure it still archives sessions and does not touch folders.

### 5.3 Search integration

**[MOD] `src/renderer/pages/SearchDialog.tsx` (if needed)**
- Ensure search results open chats regardless of folder.
- No change required if search already uses `switchCurrentSession`.

### 5.4 Settings / copilots / help navigation

**[MOD] `src/renderer/components/sidebar/SidebarFooter.tsx`**
- Settings opens `navigateToSettings()`.
- Help navigates to `/guide`.
- About navigates to `/about`.
- On mobile, close sidebar after navigation.

### 5.5 Delete folder behavior ✅ (Kısım 1'de tamamlandı)

**[MOD] `src/renderer/components/sidebar/SidebarFolderItem.tsx` / `folderStore.ts`**
- On folder delete, show a confirmation modal.
- Option A: prevent deletion if folder has children (recommended MVP). ✅
- Option B: move children to root before deletion (future enhancement).
- Update cache after deletion.

**Durum (Kısım 1):** Option A implement edildi.
- `folderStore.ts` → yeni `getFolderChildCounts(folderId)` (cache'den senkron alt klasör + chat sayısı).
- `chatStore.ts` → `InfiniteSessionData` export edildi (folderStore kullanımı için).
- `ConfirmModal.tsx` → `hideCancel` prop'u (tek butonlu uyarı modalı).
- `SidebarTree.tsx` → `deleteFolderById` NiceModal akışına: dolu = uyarı (OK only), boş = onay (Delete/Cancel, danger).
- i18n (en): 6 yeni anahtar. Bkz. `SIDEBAR_REFACTOR_NOTES.md` → Phase 5 (Kısım 1).

### 5.6 Update dot indicator

**[MOD] `src/renderer/components/sidebar/SidebarFooter.tsx`**
- Reuse existing `useShowUpdateDot` logic from old `Sidebar.tsx`.
- Show dot on About icon only (not on Settings/Help).

### 5.7 Theme / RTL / safe area

**[MOD] `src/renderer/components/sidebar/Sidebar.tsx`**
- Verify RTL (`language === 'ar'`) still positions drawer and resizer correctly.
- Verify mobile safe area insets remain intact.
- Verify dark/light theme colors use existing CSS variables.

### 5.8 Tests

**[TEST] `src/renderer/components/sidebar/useSidebarTree.test.ts`**
- Test tree building with mixed folders/sessions.
- Test depth calculation.
- Test expanded/collapsed filtering.
- Test pinned exclusion.

**[TEST] `src/renderer/stores/folderStore.test.ts`**
- Test create/update/delete/move folder and cache updates.

**[TEST] `src/renderer/stores/sessionTreeActions.test.ts`**
- Test sortOrder computation.
- Test cycle prevention.
- Test cross-folder move.

**[TEST] `src/renderer/components/sidebar/SidebarHeader.test.tsx`**
- Verify icon order and click handlers.

**[TEST] `src/renderer/components/sidebar/SidebarFooter.test.tsx`**
- Verify build number display and update dot.

**[TEST] Update existing tests**
- `sidebar-drawer.test.tsx` if import paths changed.
- `SessionList` / `SessionItem` tests if drag props changed.

### 5.9 Lint / type / smoke

- Run `pnpm run check`.
- Run `pnpm run lint`.
- Run `pnpm run test`.
- Manual smoke test:
  - Create folders and chats.
  - Drag sessions into folders.
  - Pin a chat.
  - Archive a chat.
  - Resize sidebar on desktop.
  - Open/close sidebar on mobile.
  - Click About icon and verify build number.

### 5.10 Phase 5 acceptance

- All tests pass.
- Lint/type checks pass.
- Sidebar matches the wireframe visually and behaviorally.
- No regressions in existing flows (chat, archive, search, settings, about).

---

## Appendix A — i18n Keys Checklist

Add these keys to every locale file:

- [ ] `New Folder`
- [ ] `New Chat`
- [ ] `Create Chat`
- [ ] `Pinned Chats`
- [ ] `Build Number`
- [ ] `Move to Folder`
- [ ] `Move to Root`
- [ ] `Rename Folder`
- [ ] `Delete Folder`
- [ ] `Create Subfolder`
- [ ] `New Chat in Folder`
- [ ] `Collapse Folder`
- [ ] `Expand Folder`
- [ ] `No chats yet`
- [ ] `No folders yet`
- [ ] `OK` ✅ (Kısım 1, en)
- [ ] `Cannot Delete Folder` ✅ (Kısım 1, en)
- [ ] `Are you sure you want to delete this folder?` ✅ (Kısım 1, en)
- [ ] `Folder contains chats` ✅ (Kısım 1, en)
- [ ] `Folder contains subfolders` ✅ (Kısım 1, en)
- [ ] `This folder is not empty. Please move or delete its contents first.` ✅ (Kısım 1, en)
- [ ] `Adjust order` (already exists)
- [ ] `Done` (already exists)
- [ ] `Archive` (already exists)
- [ ] `Pin` / `Unpin` (already exist)
- [ ] `Search` (already exists)
- [ ] `Collapse` (already exists)
- [ ] `Settings` (already exists)
- [ ] `Help` (already exists)
- [ ] `About` (already exists)

---

## Appendix B — File Dependency Map

```
Sidebar.tsx
├── SidebarHeader.tsx
├── SidebarTree.tsx
│   ├── useSidebarTree.ts
│   ├── SidebarFolderItem.tsx
│   ├── SidebarSessionItem.tsx
│   ├── SidebarDropIndicator.tsx
│   └── SidebarDndContext.tsx
├── SidebarFooter.tsx
├── SidebarEmptyState.tsx
├── folderStore.ts
├── sessionTreeActions.ts
└── uiStore.ts (expandedFolderIds)
```

---

## Appendix C — Recommended Order of Execution

1. Complete Phase 1 tasks in order (types → storage → store → build number → i18n).
2. Verify Phase 1 acceptance before moving on.
3. Complete Phase 2 (header/footer shell).
4. Complete Phase 3 (tree rendering).
5. Complete Phase 4 (DnD).
6. Complete Phase 5 (integration + tests + polish).
