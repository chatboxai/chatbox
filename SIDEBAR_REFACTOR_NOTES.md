# Sidebar Refactor — Implementation Notes

> Chatbox CE için sol sidebar'ın flat list'ten hiyerarşik folder/chat ağacına yeniden tasarlanması.
> Tüm identifier'lar, dosya adları ve i18n key'ler İngilizce.

---

## İçindekiler

- [Phase 1 — Foundation](#phase-1--foundation)
- [Phase 2 — Sidebar Shell](#phase-2--sidebar-shell)
- [Phase 3 — Folder Tree Rendering](#phase-3--folder-tree-rendering)
- [Bug Fix: Klasör içi New Chat görünmüyor](#bug-fix-klasör-içi-new-chat-görünmüyor)
- [Bug Fix: New Folder popup + subfolder akışı](#bug-fix-new-folder-popup--subfolder-akışı)
- [Phase 4 — Drag & Drop](#phase-4--drag--drop)
- [Doğrulama Özeti](#doğrulama-özeti)
- [Phase 5'e Bırakılanlar](#phase-5e-bırakılanlar)

---

## Phase 1 — Foundation

### Oluşturulan yeni dosyalar

| Dosya | İçerik |
|---|---|
| `src/shared/types/folder.ts` | `FolderSchema` (zod): `id`, `type:'folder'`, `name`, `parentId` (nullable), `sortOrder`, `createdAt`. `FolderArraySchema`. `Folder` tipi. |
| `src/shared/ports/folder-repository.ts` | `FolderRepositoryPort` arayüzü (Option B: ayrı depolama). `ports/index.ts`'ten re-export. |
| `src/renderer/storage/FolderStorage.ts` | `IndexedDBFolderStorage` + `FolderStorage` arayüzü. Additive-only migration (SessionMetaStorage deseni). |
| `src/renderer/storage/SQLiteFolderStorage.ts` | Mobil `@capacitor-community/sqlite` impl'ı (`folders` tablosu). |
| `src/renderer/stores/folderStore.ts` | React Query cache + CRUD. `createFolder`, `updateFolder`, `deleteFolder`, `moveFolder`, `computeFolderSortOrder`, `isFolderDescendant` (cycle detection), `useFolderList`. |

### Düzenlenen dosyalar

- **Şema:** `src/shared/types/session.ts` — `SessionSchema` ve `SessionMetaSchema`'ya `parentId` (optional string) eklendi. `SessionMetaRecord` zaten `sortOrder`/`createdAt` içeriyor.
- **Re-export:** `src/shared/types.ts`, `src/shared/ports/index.ts`.
- **SQLite session storage:** `SQLiteSessionMetaStorage.ts` — `parent_id` kolonu (CREATE TABLE + ALTER migration), INSERT/UPDATE/row mapping güncellendi.
- **Platform katmanı:** `interfaces.ts`'e `getBuildNumber()` ve `getFolderStorage()` eklendi; 4 platform impl'ı (desktop/web/mobile/test) dolduruldu.
  - Desktop: `CHATBOX_BUILD_NUMBER` env → `app.getVersion()` → `""`
  - Web: env → `package.json` version
  - Mobile: env → `App.getInfo().build` (Capacitor `AppInfo`'da gerçek alan `build`, `buildNumber` değil)
- **Build number infra:** `main.ts`'e `getBuildNumber` IPC handler; `electron.vite.config.ts` ve `vite.config.web.ts`'e `CHATBOX_BUILD_NUMBER` define; `useVersion.ts`'e `buildNumber` alanı.
- **i18n:** 14 yeni anahtar tüm 14 locale'e eklendi (alfabetik sıralı — i18next-parser uyumu için tüm dosyalar yeniden sıralandı).
- **Test:** `SQLiteSessionMetaStorage.test.ts` beklenen değer dizisi `parent_id` için güncellendi.

---

## Phase 2 — Sidebar Shell

### Oluşturulan yeni dosyalar

| Dosya | İçerik |
|---|---|
| `components/sidebar/Sidebar.tsx` | Yeni sidebar shell — resize, mobile safe area, SwipeableDrawer, update banner korundu; header/footer yeni component'lerle değiştirildi. |
| `components/sidebar/SidebarHeader.tsx` | Logo → Search → New Folder → New Chat → Collapse ikon sırası (wireframe). |
| `components/sidebar/SidebarFooter.tsx` | Settings, Help, About ikonları + About yanında build number + update dot. |

### Düzenlenen dosyalar

- `src/renderer/Sidebar.tsx` → ince re-export (`./components/sidebar/Sidebar`) — backward compatibility.
- `src/renderer/routes/__root.tsx` → import yolu `@/Sidebar` → `@/components/sidebar/Sidebar`.

### Wireframe uyumu

- **Header:** Archive/clear-list ikonu kaldırıldı; `IconFolderPlus` ve `IconMessagePlus` (+ overlay) eklendi. Collapse: mobilde `IconArrowBarRight`, masaüstünde `IconLayoutSidebarLeftCollapse`. Logo/`Chatbox` `/about`'a tıklanabilir.
- **Footer:** Eski text tabanlı nav kaldırıldı. Sadece 3 ikon: Settings (`navigateToSettings`), Help (`/guide`, `isExceeded` guard), About (`/about` + build number + update dot).
- **Create Image** sidebar'dan kaldırıldı (plan karar #2). Shell'de TODO yorumu.
- **New Chat** header ikonuna `createEmpty('chat')` ile taşındı.

### Korunan davranışlar

- Masaüstü resize handle + RTL (`ar`) konumlandırma.
- Mobil SwipeableDrawer + iOS text-interaction kontrolü + safe area inset'leri.
- Masaüstü update banner'ı (downloaded durumunda).
- macOS window controls spacer.
- Dev tools `ThemeSwitchButton`.

---

## Phase 3 — Folder Tree Rendering

### Oluşturulan yeni dosyalar

| Dosya | İçerik |
|---|---|
| `components/sidebar/useSidebarTree.ts` | `buildSidebarTree` (saf çekirdek) + `useSidebarTree` (useMemo sarmal). Folder + session join → recursive tree. `flattenSidebarTree`, `selectPinnedSessions`. |
| `components/sidebar/SidebarTree.tsx` | Virtuoso ile düz-render edilen ağaç container'ı. Pinned section + folder/chat tree + empty state. |
| `components/sidebar/SidebarFolderItem.tsx` | Klasör satırı: chevron, açık/kapalı ikon, inline rename, hover eylemleri, more menüsü, mobile context menü, tree-line. |
| `components/sidebar/SidebarSessionItem.tsx` | `SessionItem` saran ince wrapper — depth indent + tree-line. |
| `components/sidebar/SidebarSectionLabel.tsx` | Bölüm etiketi (Pinned Chats vb.) — opsiyonel leading icon. |
| `components/sidebar/SidebarEmptyState.tsx` | Ağaç boşken placeholder. |

### Düzenlenen dosyalar

- `stores/uiStore.ts` — `expandedFolderIds: string[]` state + `toggleExpandedFolderId` / `setExpandedFolderIds`, `partialize`'e eklendi (restart kalıcılığı).
- `components/sidebar/Sidebar.tsx` — `SessionList` → `SidebarTree` geçişi.

### Wireframe uyumu

- **Pinned Section:** Sparkle (`IconSparkles`) + "Pinned Chats" etiketi, flat starred list (depth 0), ağaçtan yatay `Divider`.
- **Folder Tree:** Sınırsız iç içe, genişletilebilir/kapatılabilir (chevron + rotate), dikey tree-line (`│`, `opacity-40`).
- **Tree-lines:** `depth > 0` satırlarda `INDENT_PX=16` girinti + sol kenar çizgisi.
- **Genişletme kalıcılığı:** `expandedFolderIds` `uiStore` persist'inde.

### Korunan davranışlar

- `SessionItem`'ın tüm davranışları (avatar, pin/archive hover, mobile long-press, haptics) wrapper arkasında çalışır.
- Virtuoso virtualization korundu.
- Web platformunda user-select kapalı.

---

## Bug Fix: Klasör içi New Chat görünmüyor

### Kök neden

`createChatInFolder` → `updateSession(session.id, { parentId })` çağrılıyordu ama **parentId persist edilmiyordu**:

1. `chatStore.updateSessionWithMessages` → `getSessionMeta(updated)` çağırıyor
2. `getSessionMeta` (`sessionHelpers.ts`) `pick()` ile sabit alan listesi alıyordu — **`parentId` listede yoktu**
3. `metaStorage.update` parentId'siz kaydediyor, `updateSessionListData` da `{ ...s, ...newMeta }` ile parentId'yi **overwrite edip siliyordu**

### Düzeltme

`sessionHelpers.ts` → `getSessionMeta`'nın `pick()` listesine **`parentId`** eklendi. `sortOrder` bilinçle eklenmedi — `SessionMeta`'da yok (sadece `SessionMetaRecord`'da), reorder yolları doğrudan `metaStorage`'a yazıyor.

### Test

- `stores/__tests__/getSessionMeta.test.ts` (yeni, jsdom) — ✅ 4/4: parentId koruması (regression), top-level chat, çekirdek alanlar, message data sızıntısı yok.
- `sidebar/__tests__/useSidebarTree.test.ts` (yeni) — ✅ 8/8: nesting, collapse, pinned/hidden/archived dışlama, sonsuz derinlik, sortOrder interleave, depth.

### Refactoring

`useSidebarTree`'nin çekirdek mantığı **saf `buildSidebarTree`** fonksiyonuna çıkarıldı → jsdom gerektirmeden node ortamında test edilebilir.

---

## Bug Fix: New Folder popup + subfolder akışı

### Sorun

"New Folder" ikonuna tıklayınca isim soran popup yoktu — doğrudan `"New Folder"` default ismiyle oluşturuluyordu.

### Düzeltme

- **`modals/CreateFolderModal.tsx`** (yeni) — `AdaptiveModal` + `NiceModal` deseni (`ThreadNameEdit` gibi):
  - İsim input (auto-focus desktop), Enter = oluştur, Esc = iptal
  - `Create` butonu boş isimde disabled, oluşturmada loading
  - `parentId` prop → top-level (`null`) veya subfolder
  - `resolve(folder)` ile oluşturulan `Folder` döner, iptalde `undefined`
  - Mobilde drawer, masaüstünde centered modal
- **`modals/index.tsx`** → `create-folder` registry kaydı.
- **`Sidebar.tsx`** → `handleCreateNewFolder` → `NiceModal.show('create-folder')`.
- **`SidebarTree.tsx`** → `createSubfolder` → modal çağırır + parent'ı genişletir.

### Akış

1. Header "New Folder" → popup → isim gir → `createFolder(name, null)` → top-level
2. Folder item "Create Subfolder" → popup (parent dolu) → `createFolder(name, parentId)` → parent genişletilir → subfolder görünür

---

## Phase 4 — Drag & Drop

### Çekirdek (saf, test edilebilir)

| Dosya | İçerik |
|---|---|
| `components/sidebar/treeDrop.ts` | `computeTreeDrop` — saf resolver: pinned↔tree geçişleri, klasör içi taşıma, seviye içi reorder, cycle prevention. `applyTreeDrop` — store mutation'larına çevirir (dynamic import ile). `PINNED_SECTION_ID`, `ROOT_DROP_ID`, `SidebarFlatRow`, `TreeDropResult`. |
| `stores/session/crud.ts` | `moveSession(sessionId, parentId, sortOrder)` — parentId + sortOrder doğrudan `metaStorage.update`'e yazar (`updateSession` sortOrder'yu düşürdüğü için). |

### Entegrasyon

- `SidebarTree.tsx` → `DndContext` + `SortableContext` + `DragOverlay` (mevcut `SessionList` deseni).
- `SortableTreeRow` wrapper (useSortable + CSS transform).
- `PinnedSectionDroppable` (pin için drop target, `useDroppable`).
- Sensor'lar: mouse (distance:10), touch (delay:150), keyboard.
- Mobil reorder modu (`isReordering` state).
- `onDragEnd` → `computeTreeDrop` → `applyTreeDrop`.

### Desteklenen işlemler

- **Seviye içi reorder** (aynı parent, fractional sortOrder)
- **Klasöre taşıma** (session/folder → folder içine)
- **Root'a taşıma**
- **Pin**: tree session → pinned section (`starred=true`)
- **Unpin**: pinned session → folder veya tree session (`starred=false`)
- **Cycle prevention**: klasör kendi descendant'ının içine taşınamaz

### Test

- `sidebar/__tests__/treeDrop.test.ts` (yeni) — ✅ 14/14: reorder (within-parent + move-to-folder), move-into-folder, cycle rejection, self-drop rejection, pin/unpin transitions, root drop, edge cases.

### Cycle detection mantığı

`resolveFolderDrop`: dragged folder target'in ancestor'ı veya kendisiyse reddedilir → `isDescendantFolder(dragged.id, targetFolderId, folders)`. (İlk implementasyonda parametreler ters yazılmıştı, test yakaladı.)

### Reorder semantiği

Dragged item anchor'ın **üstüne** (daha yüksek sortOrder) yerleşir. Descending-sorted siblings'te: `before` = `siblings[anchorIndex-1]` (yüksek sortOrder), `after` = anchor. `computeSortOrder(before, after)`.

---

## Doğrulama Özeti

| Kontrol | Sonuç |
|---|---|
| `tsc --noEmit` | Sidebar/treeDrop/crud/sessionHelpers dosyalarında **sıfır** tip hatası. Pre-existing hatalar aynı kaldı (preview-server, MessageLoading, __root.tsx, web-search-tool, AgentModeRewardQuotaCard). Mobile `buildNumber`→`build` düzeltmesi ile 8→7. |
| `biome check` | Sidebar dosyaları temiz. sessionHelpers'taki unused-var diagnostic'leri pre-existing. |
| `vitest` | treeDrop 14/14, useSidebarTree 8/8, getSessionMeta 4/4, sidebar-drawer 3/3, sortSessionRecords 11/11, chatStore-cache 4/4, SessionMetaStorage + SQLiteSessionMetaStorage geçiyor. |
| `electron-vite build` | ✅ Başarılı (~22-26s). |

### Önemli notlar

- `SessionList.tsx` (eski flat list) hâlâ projede ama `SidebarTree` tarafından değiştirildi. Phase 5'te temizlenebilir.
- `getSessionMeta` parentId düzeltmesi **DnD için de kritik** — `moveSession` ve pin/unpin `updateSession({starred})` çağrıları bu yolu kullanır.
- Vitest `silent: true` + node ortamı: `navigator.userAgent` jsdom gerektiren testler `// @vitest-environment jsdom` annotation'ı ile çalıştırılır.

---

## Phase 5'e Bırakılanlar

- **Drop indicator**: DragOverlay var ama satırlar arası görsel insert-line indicator yok (basit opacity=0 dragging).
- **Mobil "Done" butonu**: `isReordering` state'i var, grip handle mobilde görünür ama header'da "Done" butonu yok (eski SessionList'teydi).
- **Klasör silme confirm modal**: Hâlâ doğrudan `deleteFolder`. Boş klasör kontrolü + NiceModal confirm eklenecek.
- **`createEmpty` parentId desteği**: `createChatInFolder` önce chat oluşturup sonra `updateSession({parentId})` ile taşıyor. `createEmpty`'ye parentId desteği eklenecek (TODO işaretli).
- **Create-and-immediately-rename**: `CreateFolderModal` isim soruyor ama klasör oluşturulduktan sonra inline rename edit moduna geçme akışı geliştirilebilir.
- **`SessionList.tsx` temizliği**: Eski flat list component'i tamamen kaldırılıp import'lar temizlenebilir.
- **i18n anahtar doğrulama**: Tüm diller için yeni anahtarların çevirileri (şu an English fallback value ile).
- **Kapsamlı entegrasyon testleri**: DnD end-to-end, klasör oluşturma/silme akışları.