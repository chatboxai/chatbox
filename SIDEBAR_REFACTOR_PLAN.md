# Sidebar Refactor Plan — Chatbox CE

> **Scope:** Simplify the left sidebar and add a hierarchical folder/chat classification tree, as described in the provided wireframe. All code identifiers, file names, and i18n keys must remain in English (no Turkish in source code).

---

## 1. Current Project Context

### 1.1 Stack & Architecture

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron + `electron-vite` |
| UI framework | React 18, Mantine v7, MUI Drawer (swipeable), Tailwind CSS |
| Routing | `@tanstack/react-router` |
| State | Jotai atoms + Zustand (`uiStore`, `settingsStore`) + React Query for session lists |
| Storage | IndexedDB (`SessionMetaStorage`) on desktop/web, SQLite (`SQLiteSessionMetaStorage`) on mobile |
| i18n | `i18next` / `react-i18next`, locale JSON files under `src/renderer/i18n/locales/{lang}/translation.json` |
| Lint/Format | Biome |

### 1.2 Relevant Files Today

| File | Responsibility |
|------|----------------|
| `src/renderer/Sidebar.tsx` | Left panel shell: header actions, resize handle, bottom links, update banner |
| `src/renderer/components/session/SessionList.tsx` | Renders the scrollable list of sessions, pinned section, drag-to-reorder (dnd-kit), Virtuoso |
| `src/renderer/components/session/SessionItem.tsx` | Single row: avatar, name, time, pin/archive actions, long-press mobile menu |
| `src/renderer/stores/chatStore.ts` | React Query cache + CRUD helpers for `SessionMetaRecord` pages |
| `src/renderer/stores/session/crud.ts` | `reorderSessions`, `createEmpty`, `switchCurrentSession` |
| `src/renderer/storage/SessionMetaStorage.ts` | IndexedDB implementation of `SessionMetaRepositoryPort` |
| `src/renderer/storage/SQLiteSessionMetaStorage.ts` | Mobile SQLite implementation |
| `src/shared/types/session.ts` | Zod schemas: `SessionSchema`, `SessionMetaSchema`, `SessionMetaRecordSchema` |
| `src/shared/ports/session-repository.ts` | `SessionMetaRepositoryPort` interface |
| `src/renderer/hooks/useVersion.ts` | Returns `version` string + `needCheckUpdate` flag |
| `src/renderer/routes/about.tsx` | About page content |
| `src/renderer/modals/ClearSessionList.tsx` | Bulk archive modal triggered from the current header archive icon |
| `src/renderer/i18n/locales/*/translation.json` | Translations for labels used in the sidebar |

### 1.3 Current Sidebar Behavior

- **Header icons (left to right):** search, archive/clear conversation list, collapse sidebar.
- **Body:** Virtuoso list with two possible sections: `Pinned` and `Chats`.
- **Pinned:** sessions where `starred === true`. Rendered as a section label.
- **Reorder:** drag-and-drop using `@dnd-kit`. Only allowed within the same pin group.
- **Bottom links:** `New Chat`, `Create Image`, `My Copilots`, `Settings`, `Help`, `About` (desktop) / icon row (mobile).
- **About entry:** shows version number next to the label only on desktop; mobile shows a dot indicator.

---

## 2. New Requirements (from Wireframe)

### 2.1 Header Icons

Order: **Search → Create Folder → Create Chat → Collapse Panel**.

Wireframe note: The folder and chat icons both carry a small "+" overlay to indicate "create" action. The collapse icon is a right arrow (`→`) representing "hide panel".

- Remove the current archive/clear-list icon from the header.
- Move "Create Image" out of the sidebar bottom buttons (it is not in the wireframe). Keep it reachable from the main toolbar / new-chat flow if still needed.
- Keep search and collapse behavior.
- Logo/title on the left remains clickable (existing behavior: navigates to `/about` or opens the brand menu depending on platform).

### 2.2 Pinned Chats

- If pinned sessions exist, render a `Pinned Chats` section at the top with the label prefixed by a sparkle/star icon.
- The section shows pinned sessions in a flat list (no folder nesting, matching the wireframe's two flat items: Chat 03, Chat 04).
- Each pinned row has a subtle vertical tree-line indent on the left (visual consistency with the folder tree, not a logical nesting).
- Separate the pinned section from the tree with a single horizontal `<Divider />` rendered directly below the pinned items.
- If no pinned sessions exist, the entire section (label + items + divider) is removed; the tree starts immediately at the top.

### 2.3 Folder & Chat Tree

- Folders can be nested infinitely (wireframe shows Dizin 01 > Dizin 02 > Chat 01).
- Every folder level may contain both chats and sub-folders.
- Folders are expandable/collapsible; the wireframe shows Dizin 01 in the expanded state.
- Folder rows render with a vertical tree-line connecting parent to children (matching the visual style used in the pinned section).
- Folder state is persisted per user (e.g., `expandedFolderIds` in `uiStore` or settings).
- Drag-and-drop must support:
  - Reordering chats inside a folder.
  - Moving a chat into/out of/between folders.
  - Reordering folders relative to siblings.
  - Moving folders into other folders (nested).

### 2.4 Bottom Icons

Three icon-only actions: **Settings**, **Help**, **About** (wireframe bottom-left corner).

- Remove the current text-based bottom nav links (`New Chat`, `Create Image`, `My Copilots`, `Settings`, `Help`, `About`).
- Keep the existing update dot indicator near the About icon.
- The About icon's immediate right area must display the **build number** as plain text (e.g., `1.2.3+42`).
- Clicking the About icon navigates to `/about` exactly as the current About link does.

### 2.5 Simplification

- Reduce visual noise: fewer bottom buttons, icon-only header, clear separation between pinned and tree.
- Keep the resizable sidebar behavior for desktop.
- Keep mobile swipeable drawer behavior.

---

## 3. User Cases

### 3.1 Primary User Cases

| ID | Actor | Action | Expected Result |
|----|-------|--------|-----------------|
| UC-1 | User | Clicks search icon in sidebar header | Opens the existing global search dialog |
| UC-2 | User | Clicks create-folder icon in sidebar header | Creates a new top-level folder and focuses its name inline |
| UC-3 | User | Clicks create-chat icon in sidebar header | Creates a new empty chat and switches to it (same as current "New Chat") |
| UC-4 | User | Clicks collapse icon in sidebar header | Hides the sidebar (desktop) or closes the drawer (mobile) |
| UC-5 | User | Has pinned chats | Sees `Pinned Chats` section, separated by a horizontal rule |
| UC-6 | User | Has no pinned chats | Pinned section is absent; tree starts immediately |
| UC-7 | User | Clicks a folder row | Expands/collapses the folder and reveals/hides its children |
| UC-8 | User | Right-clicks/long-presses a chat | Opens context menu with Pin/Unpin, Archive, Move to folder, Rename, Delete |
| UC-9 | User | Right-clicks/long-presses a folder | Opens context menu with Rename, New chat here, New sub-folder, Delete, Move to folder |
| UC-10 | User | Drags a chat onto a folder | Moves the chat into that folder |
| UC-11 | User | Drags a folder onto another folder | Moves the dragged folder as a child of the target folder |
| UC-12 | User | Clicks Settings/Help/About bottom icon | Navigates to the corresponding route/modal |
| UC-13 | User | Looks at bottom About icon | Sees the build number displayed next to the icon |

### 3.2 Edge Cases

- Empty sidebar: no folders, no chats, no pinned items. Show an empty-state prompt.
- All chats archived: tree is empty, show empty state.
- Very deep nesting: tree must remain performant (virtualized + lazy children).
- Mobile long-press conflicts with folder expand/collapse: separate tap vs. press gestures.
- Dragging across expanded/collapsed folders: visual drop indicator must appear between rows and on folder rows.

---

## 4. Data Model Impact

### 4.1 New Concept: `Folder`

A folder is **not** a chat session. It is a classification container with metadata only. The schema lives in its own file to keep concerns separate:

```ts
// src/shared/types/folder.ts
export const FolderSchema = z.object({
  id: z.string(),
  type: z.literal('folder'),
  name: z.string(),
  parentId: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.number(),
})

export const FolderArraySchema = z.array(FolderSchema)

export type Folder = z.infer<typeof FolderSchema>
```

The file is then re-exported from `src/shared/types/index.ts` (or `src/shared/types.ts`) so consumers can `import { Folder } from '@shared/types'`.

### 4.2 Session Schema Extension

Add `parentId` to sessions so a chat can live inside a folder:

```ts
// In SessionSchema
parentId: z.string().optional(),

// In SessionMetaSchema & SessionMetaRecordSchema
parentId: true,
```

### 4.3 Unified List Item

The sidebar tree operates on a union type:

```ts
export type SidebarItem =
  | { kind: 'folder'; data: Folder }
  | { kind: 'session'; data: SessionMetaRecord }
```

### 4.4 Storage Layer

Two implementation paths:

| Option | Pros | Cons |
|--------|------|------|
| A. Same `session_meta` table, add `type='folder'` rows | Minimal schema change, single query | Mixes containers with sessions; must exclude folders from chat APIs |
| B. Separate `folder` store/table | Clean separation, easier queries, better future migrations | Larger change, requires new repository port + migrations |

**Recommendation:** Option B — introduce a `FolderStorage` / `FolderRepositoryPort` alongside `SessionMetaStorage`. The sidebar can join both datasets in memory. This avoids polluting chat-session queries with folder rows.

### 4.5 Migration

- New DB store/table `folders` must be created on first launch.
- Existing `SessionMetaRecord` rows have `parentId = undefined`, meaning they are top-level.
- No automatic folder creation for existing data (keep flat tree initially).

---

## 5. UI/UX Plan

### 5.1 New Sidebar Header

```
[Chatbox logo/name]  [Search] [New Folder] [New Chat] [Collapse]
```

- Use `ActionIcon` with tooltips for all header actions.
- **New Folder icon:** `IconFolderPlus` (folder glyph with "+" overlay, matches wireframe).
- **New Chat icon:** `IconMessagePlus` or `IconMessage2Plus` (chat glyph with "+" overlay, matches wireframe).
- **Collapse icon:** `IconLayoutSidebarRightCollapse` or simple `IconArrowBarRight` (right arrow `→`, matches wireframe).
- Remove archive icon and its `NiceModal.show('clear-session-list')` call.
- Tooltips follow Mantine `Tooltip` with `openDelay={1000}` matching the current style.

### 5.2 Pinned Section

```tsx
{pinnedSessions.length > 0 && (
  <>
    <SidebarSectionLabel icon={<IconSparkles />} label={t('Pinned Chats')} />
    {pinnedSessions.map(session => (
      <SidebarSessionItem
        session={session}
        depth={0}
        showTreeLine
        showStarIcon={false} // already implied by section
      />
    ))}
    <Divider />
  </>
)}
```

- Pinned items ignore `parentId`; they always render in the pinned section.
- Pinned section uses an `<Divider />` directly below the last pinned item to separate it from the tree (matches the HR in the wireframe).
- Pinned rows render with a thin vertical tree-line on the left (`│` shape) for visual rhythm with the folder tree below.
- If `pinnedSessions.length === 0`, the entire block (label + items + divider) is removed.

### 5.3 Folder Tree

Create a new recursive component tree:

```
src/renderer/components/sidebar/
  Sidebar.tsx           (move from src/renderer/Sidebar.tsx)
  SidebarHeader.tsx
  SidebarFooter.tsx
  SidebarTree.tsx
  SidebarFolderItem.tsx
  SidebarSessionItem.tsx (wraps existing SessionItem)
  SidebarEmptyState.tsx
  SidebarSectionLabel.tsx
```

Each folder row shows:
- Expand/collapse chevron (`IconChevronRight` rotated 90° when expanded).
- Folder icon (`IconFolder` / `IconFolderOpen`).
- Name (inline editable on create/rename).
- Vertical tree-line connecting to children when expanded (matches wireframe).
- Hover actions: new chat, new sub-folder, more menu.

Each session row in the tree shows:
- Chat icon (`IconMessage` or current session avatar).
- Name.
- Vertical tree-line on the left when nested inside a folder.
- Indent by `depth * 16px`.

Visual rules for tree-lines:
- Draw a thin vertical line (`1px`, `currentColor / opacity 0.2`) on the left edge of every child row, aligned to the parent's chevron/folder icon center.
- Use absolute-positioned `<span>` per row or a single SVG overlay; choose the cheaper approach in implementation.

### 5.4 Drag & Drop Refactor

Current dnd-kit is horizontal-axis-only and session-only. New requirements:
- Use `@dnd-kit/core` + `@dnd-kit/sortable` for the whole tree.
- Drop targets include both sessions (for reordering) and folders (for containment).
- Compute new `parentId`, `sortOrder`, and `starred` (dropped into pinned area sets starred=true).

### 5.5 Bottom Footer

Replace text nav with icon row:

```
[Settings icon] [Help icon] [About icon + build number]
```

- Keep dot indicator on About icon for updates.
- About icon click: `navigate({ to: '/about' })` and close sidebar on mobile.
- Build number: derive from a new `platform.getBuildNumber()` method (fallback to `versionHook.version` if no build number is available).

### 5.6 Build Number Source

Add environment/runtime support:

- **Build-time injection:**
  - `electron.vite.config.ts` defines `process.env.CHATBOX_BUILD_NUMBER` (fallback to `packageJson.version`).
  - `vite.config.web.ts` defines the same variable for the web build.
  - CI may override `CHATBOX_BUILD_NUMBER` with an actual build number.
- **Main process:**
  - `src/main/main.ts`: expose `ipcMain.handle('getBuildNumber', () => process.env.CHATBOX_BUILD_NUMBER || app.getVersion())`.
- **Renderer platform layer:**
  - `src/renderer/platform/interfaces.ts`: add `getBuildNumber(): Promise<string>`.
  - Desktop: returns IPC value.
  - Mobile: returns `App.getInfo().buildNumber` from Capacitor or env fallback.
  - Web: returns `process.env.CHATBOX_BUILD_NUMBER || ''`.
- **Hook:**
  - Update `useVersion` hook to expose `buildNumber` alongside `version`.

Fallback chain used everywhere: `process.env.CHATBOX_BUILD_NUMBER` → `packageJson.version` → empty string (UI hides the badge).

---

## 6. File Change List

### 6.1 New Files

| Path | Purpose |
|------|---------|
| `src/renderer/components/sidebar/Sidebar.tsx` | New sidebar shell (migration of current `Sidebar.tsx`) |
| `src/renderer/components/sidebar/SidebarHeader.tsx` | Header actions |
| `src/renderer/components/sidebar/SidebarFooter.tsx` | Bottom icon row + build number |
| `src/renderer/components/sidebar/SidebarTree.tsx` | Recursive folder/session tree |
| `src/renderer/components/sidebar/SidebarFolderItem.tsx` | Folder row UI + expand/collapse + inline rename |
| `src/renderer/components/sidebar/SidebarSessionItem.tsx` | Thin wrapper around `SessionItem` for tree usage |
| `src/renderer/components/sidebar/SidebarEmptyState.tsx` | Empty tree placeholder |
| `src/renderer/components/sidebar/SidebarDndContext.tsx` | Drag-and-drop provider for tree |
| `src/renderer/components/sidebar/useSidebarTree.ts` | Hook that joins folders + sessions into tree items |
| `src/renderer/stores/folderStore.ts` | CRUD + React Query cache for folders |
| `src/renderer/stores/sessionTreeActions.ts` | Move/reorder helpers across folders |
| `src/renderer/storage/FolderStorage.ts` | IndexedDB folder storage |
| `src/renderer/storage/SQLiteFolderStorage.ts` | SQLite folder storage |
| `src/shared/types/folder.ts` | `FolderSchema`, `Folder` type |
| `src/shared/ports/folder-repository.ts` | `FolderRepositoryPort` |

### 6.2 Modified Files

| Path | Change |
|------|--------|
| `src/renderer/Sidebar.tsx` | Convert to thin re-export from `./components/sidebar/Sidebar` for backward compatibility |
| `src/renderer/routes/__root.tsx` | Update import path of `Sidebar` |
| `src/renderer/components/session/SessionList.tsx` | Remove from sidebar; keep file for future reuse if needed (no hard deletion) |
| `src/renderer/components/session/SessionItem.tsx` | Accept optional `parentId`, expose drag props |
| `src/renderer/stores/chatStore.ts` | Add `parentId` to session cache updates |
| `src/renderer/stores/session/crud.ts` | Add move/reorder helpers that consider `parentId` |
| `src/renderer/storage/SessionMetaStorage.ts` | Add `parentId` handling if folders share table (Option A) or no change (Option B) |
| `src/renderer/storage/SQLiteSessionMetaStorage.ts` | Same as above |
| `src/shared/types/session.ts` | Add `parentId` to schemas |
| `src/renderer/hooks/useVersion.ts` | Add `buildNumber` |
| `src/renderer/platform/interfaces.ts` | Add `getBuildNumber` |
| `src/renderer/platform/desktop_platform.ts` | Implement `getBuildNumber` via IPC |
| `src/renderer/platform/web_platform.ts` | Return env/build number fallback |
| `src/renderer/platform/mobile_platform.ts` | Return Capacitor app info or env |
| `src/main/main.ts` | Add `getBuildNumber` IPC handler |
| `src/renderer/i18n/locales/en/translation.json` | Add new keys: `New Folder`, `Pinned Chats`, `Build Number`, `Move to Folder`, etc. |
| `src/renderer/i18n/locales/*/translation.json` | Add same keys (English fallback) for all locales |
| `electron.vite.config.ts` / `vite.config.web.ts` | Define `process.env.CHATBOX_BUILD_NUMBER` |

### 6.3 Optional Deleted/Deprecated

- `src/renderer/modals/ClearSessionList.tsx` can remain but is no longer triggered from the sidebar header. Keep for settings archive page if useful.

---

## 7. Implementation Phases

### Phase 1 — Foundation (no UI change yet)

1. Add `Folder` shared types and `parentId` to session schemas.
2. Implement `FolderStorage` (IndexedDB + SQLite) and `FolderRepositoryPort`.
3. Add `folderStore.ts` with create/update/delete/move queries and cache.
4. Add `getBuildNumber` to platform layer + main IPC + environment variable.
5. Extend `useVersion` to return `buildNumber`.
6. Add i18n keys for new labels.
7. Run lint/type checks.

### Phase 2 — Sidebar Shell

1. Move `src/renderer/Sidebar.tsx` → `src/renderer/components/sidebar/Sidebar.tsx`.
2. Create `SidebarHeader.tsx` with new icon order.
3. Create `SidebarFooter.tsx` with Settings/Help/About icons + build number.
4. Update `routes/__root.tsx` import.
5. Remove archive icon from header; remove bottom text links.
6. Verify mobile/desktop behavior.

### Phase 3 — Folder Tree

1. Create `useSidebarTree` to merge `SessionMetaRecord[]` + `Folder[]` into a tree.
2. Implement `SidebarTree`, `SidebarFolderItem`, `SidebarSessionItem`.
3. Add expand/collapse state persistence (`uiStore` atom or settings).
4. Add inline folder rename/create.
5. Render pinned section with `<hr>` separator.
6. Wire context menus for folder/session.

### Phase 4 — Drag & Drop

1. Replace current `SessionList` dnd-kit with a tree-wide `DndContext`.
2. Implement drop detection: between siblings vs. into folder.
3. Update `sessionTreeActions.ts` to compute new `parentId` + `sortOrder`.
4. Keep mobile reorder mode (long-press → drag handle).
5. Test pinned area drops.

### Phase 5 — Integration & Polish

1. Migrate old flat session list to new tree.
2. Ensure archive, search, and about flows still work.
3. Add/update unit tests for tree building and CRUD.
4. Verify i18n keys in all locales.
5. Biome lint + type check.
6. Manual smoke test on desktop and mobile layouts.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Storage schema migration fails on downgrade | Keep additive-only migrations; catch `VersionError` and reopen without version (per existing IndexedDB comment) |
| Drag-and-drop becomes complex with nested virtualization | Render only visible tree; use small fixed item size; avoid deeply recursive re-renders with memoization |
| Mobile long-press conflicts with folder expand | Use distinct thresholds; folder tap toggles expand, long-press opens menu |
| Existing `SessionList` tests break | Update tests or keep old component unused; add new tests for `SidebarTree` |
| i18n missing for new keys | Always add English fallback in every locale file |
| Build number unavailable in web build | Fallback to `version` string; show nothing if neither exists |

---

## 9. Open Decisions

1. **Folder storage strategy:** Option A (same table) vs. Option B (separate table). **Recommendation:** Option B.
2. **Where does "Create Image" live?** Wireframe removes it from sidebar; it can move to main toolbar or new-chat menu.
3. **Should pinned chats also be reorderable by drag?** Yes, within the pinned section only.
4. **Should folders be archivable?** No in MVP; only chats are archived. Folders with all children archived can show empty or auto-hide.
5. **Search results behavior:** Keep existing global search; results open the chat directly regardless of folder.

---

## 10. Next Step Recommendation

Start with **Phase 1** (data model + storage + platform build number). Once the backend state is solid, build the new sidebar shell, then the tree, then DnD. This minimizes UI churn while the data layer stabilizes.
