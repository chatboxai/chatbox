# 会话管理系统（Session Management）

> Last updated: 2026-07

本文档描述 Chatbox 的会话管理系统设计，涵盖数据模型、模块拆分、新会话机制、线程历史、消息分叉等核心功能。聚焦于**产品设计与架构决策**，具体实现请参阅源码 `src/renderer/stores/session/`。

---

## 数据模型

Chatbox 的会话系统围绕四个核心实体构建：

### Session（会话）

会话是最顶层的容器，代表一次独立的对话上下文。关键属性包括：

- `id` — 唯一标识符（UUID），新会话创建前使用临时 ID `"new"`
- `name` — 会话名称（支持自动生成）
- `type` — 会话类型：`chat`（对话）或 `picture`（图片生成）
- `messages` — 当前活跃线程的消息列表
- `threads` — 历史线程数组（归档的对话分支）
- `threadName` — 当前活跃线程的名称
- `messageForksHash` — 消息分叉索引（记录每条消息的分支信息）
- `settings` — 会话级模型设置（覆盖全局默认值）
- `copilotId` — 关联的 Copilot 预设

### Message（消息）

消息是对话的基本单元，每条消息包含角色（`user` / `assistant` / `system`）、内容、时间戳等。消息通过 `createMessage()` 工厂函数创建，确保格式统一。

### Thread（线程）

线程是会话内的对话分支。当用户在同一会话中开启新话题时，当前消息列表会被归档为一个 `SessionThread`（存入 `session.threads`），然后重新开始新的消息列表。每个线程包含：

- `id` — 线程标识符
- `name` — 线程名称
- `messages` — 该线程的消息快照

线程机制允许用户在同一会话中管理多个独立话题，避免上下文混乱。

### Fork（分叉）

分叉是消息级别的分支机制。当用户对某条消息重新生成回复或手动创建分支时，系统会在该消息位置创建一个分叉点，存储多个可选的后续消息。通过 `messageForksHash` 索引管理，用户可以在不同分支之间切换浏览。

## Session 持久化与 React read model

Session 生命周期已经拆成无 React 的 Application 层、宿主 Adapter、React Query bindings 和
Renderer Presentation：

```text
现有组件 / stores/session/*
          │
          ▼
rendererApplication（组合根）/ stores/session/* 域模块
          │
          ├──────────────► SessionService ──► SessionWriteCoordinator
          │                        │                    │
          │                        ▼                    ▼
          │                Session application events  CurrentSessionRepository
          │                        │                    │
          ▼                        ▼                    ▼
共享 hooks ◄── SessionQueryBridge / Query definitions  当前 storage + Session meta
                                   │
                                   ▼
                         Renderer Presentation effects
```

| 层 | 路径 | 职责 |
|----|------|------|
| Application | `packages/chatbox-core/src/application/session/` | Session 创建、更新、归档、恢复、删除、事件和串行写入 |
| Adapter | `src/renderer/adapters/CurrentSessionRepository.ts` | 沿用当前 storage key、migration 和 Session meta 实现 |
| React bindings | `packages/chatbox-react/src/query/` | Query keys/options/hooks、分页 read model 和应用事件投影 |
| Presentation | `src/renderer/presentation/session/` | 删除确认、滚动缓存、UI/Jotai 状态和宿主资源清理 |
| Composition | `src/renderer/app/renderer-application.ts`、`session-bootstrap.ts` | 组装应用图（`rendererApplication`）并在 Renderer 启动时注册 Presentation effects |
| Session 域模块 | `src/renderer/stores/session/`（crud / messages / session-settings 等） | 调用方直接 import 域模块或 `rendererApplication`（chatStore 兼容 facade 已删除） |

### 写入一致性

`SessionWriteCoordinator` 按 Session id 串行执行 read-modify-write。当前 Renderer 为首次写入注入
React Query-backed reader，因此流式生成期间只存在于 cache 的新消息不会被随后的元数据写入覆盖。
完整 Session 写入成功后才更新协调器内存状态，再更新 Session meta。

`SessionService` 不 import QueryClient、React、Modal、Router 或组件。它在持久化操作完成后发布精确
事件；`SessionQueryBridge` 使用传入的 QueryClient 和 `setQueryData` 更新 read model。批量删除会在
storage/meta 操作完成后重新读取第一页，避免仅过滤已加载 pages 而留下错误的 `total` 或
`nextCursor`。

### 删除副作用

删除确认保留在 `session-deletion-confirmation.ts`。SessionService 发布 `session-will-delete` 后，
Renderer effects 先清理 Session attachment RAG；持久化删除完成后再通过 `session-deleted` 清理
Web browsing、知识库、Agent Mode、Jotai atom、滚动位置和 Sandbox artifacts。

`session-bootstrap.ts` 由 Renderer 入口初始化，使 session 数据依赖链不再反向 import
`MessageList`。

---

## 模块拆分决策

> 关联决策：[#10 — Session 模块拆分](./key-decisions.md)
> 详细方案：[`docs/session-module-split-plan.md`](../session-module-split-plan.md)

### 问题背景

原始的 `sessionActions.ts` 文件膨胀至 **1799 行**，承担了会话 CRUD、消息操作、线程管理、分叉逻辑、AI 生成编排、命名、导出等全部职责。文件过大导致代码可读性下降、维护困难、合并冲突频繁。

### 拆分方案

按领域职责将单一文件拆分为 **11 个专注模块**：

| 文件 | 职责 | 导出函数数 |
|------|------|-----------|
| `crud.ts` | 会话生命周期 — 创建、切换、排序、删除 | 8 |
| `messages.ts` | 消息 CRUD — 插入、修改、删除、提交用户消息 | 5 |
| `threads.ts` | 线程管理 — 创建、切换、归档、压缩、提升为独立会话 | 9 |
| `forks.ts` | 消息分叉 — 创建分支、切换分支、删除、展开 | 5 |
| `generation.ts` | AI 生成编排 — 调用模型、构建上下文、流式响应 | 8 |
| `naming.ts` | 自动命名 — 会话名称和线程名称的防抖生成 | 4 |
| `export.ts` | 导出功能 — 将会话导出为文件 | 1 |
| `state.ts` | 共享状态 — 命名防抖的 Map/Set | — |
| `types.ts` | 内部类型 — `MessageForkEntry`、`MessageLocation` | — |
| `utils.ts` | 共享工具 — 事件追踪、消息查找、错误处理 | 4 |
| `index.ts` | 公共 API — 统一重导出全部 40+ 个函数 | 全部 |

### 设计原则

- **单向依赖**：模块间避免循环导入。`generation.ts` 导出 `generate`，`messages.ts` 导入它；反向不成立。
- **内部函数不导出**：以 `_` 前缀标记的内部辅助函数（如 `_generateName`、`_copySession`）仅在模块内部使用。
- **统一入口**：`index.ts` 作为唯一公共 API，外部模块统一从 `stores/session` 导入，无需关心内部文件结构。

---

## 新会话机制

> 关联决策：[#11 — 临时会话 ID 模式](./key-decisions.md)
> 详细设计：[`docs/new-session-mechanism.md`](../new-session-mechanism.md)

### 核心思路

用户打开首页时，系统**不立即创建持久化会话**，而是使用临时 ID `"new"` 标识一个尚未持久化的会话状态。只有当用户发送第一条消息时，才真正创建会话并写入存储。

### 工作流程

```
用户打开首页 → 临时会话 (id="new")
    ↓ 选择模型、知识库、Copilot
    ↓ 临时状态存储在 newSessionStateAtom
    ↓
用户发送消息 → 创建真正的会话 (id=UUID)
    ↓ 转移临时状态到新会话
    ↓ 清空 newSessionStateAtom
    ↓ 切换路由到新会话
```

### 设计收益

- **避免空会话污染**：未发送消息的会话不会出现在会话列表中。
- **职责分离**：临时状态（`newSessionStateAtom`）与持久状态（`sessionKnowledgeBaseMap`）分开管理，互不干扰。
- **无缝体验**：用户在发送消息前的所有设置（模型选择、知识库、网页浏览模式等）在会话创建后自动继承。

---

## 线程历史管理

线程系统为用户提供在同一会话中管理多个话题的能力，避免频繁创建新会话。

### 核心操作

- **开启新线程**（`startNewThread` / `refreshContextAndCreateNewThread`）：将当前消息归档为历史线程，清空消息列表，开始新话题。
- **切换线程**（`switchThread`）：将当前上下文存入历史，恢复目标线程的消息和名称。
- **压缩并创建线程**（`compressAndCreateThread`）：对当前对话进行摘要压缩后归档，适用于长对话场景。
- **提升为独立会话**（`moveThreadToConversations` / `moveCurrentThreadToConversations`）：将线程从当前会话中提取出来，创建为独立的顶级会话。
- **编辑与删除**（`editThread` / `removeThread` / `removeCurrentThread`）：修改线程名称或删除线程。

### 数据流

线程切换时，系统执行一次"存-取"操作：

1. 将当前 `messages` + `threadName` 快照存入 `session.threads`
2. 从 `session.threads` 中取出目标线程的消息
3. 替换当前 `messages` 和 `threadName`

这确保了线程间的上下文完全隔离，切换不会丢失任何对话内容。

---

## 消息分叉（Branching）

分叉机制让用户可以对同一条消息探索不同的回复方向，类似版本控制中的分支。

### 操作说明

| 操作 | 函数 | 行为 |
|------|------|------|
| 创建分叉 | `createNewFork` | 在指定消息处创建新分支，复制当前消息到新分支 |
| 切换分叉 | `switchFork` | 在同一分叉点的不同分支间前后切换 |
| 删除分叉 | `deleteFork` | 移除当前分支，回退到相邻分支 |
| 展开分叉 | `expandFork` | 将所有分支内容平铺展开 |
| 定位消息 | `findMessageLocation` | 在根消息列表和线程消息中查找目标消息的位置 |

### 数据结构

分叉信息通过 `session.messageForksHash` 索引存储，键为分叉点消息的 ID，值包含该位置所有分支的消息及当前活跃分支索引。内部使用 `applyForkTransform` 统一处理分叉变换，`computeNextMessageForksHash` 计算变换后的索引状态。

---

## AI 生成编排

`generation.ts` 是系统中最复杂的模块（约 450 行），负责协调 AI 模型调用：

- **上下文构建**（`genMessageContext`）：收集当前消息、线程历史、系统提示词、知识库检索结果等，构建发送给模型的完整上下文。
- **流式生成**（`generate`）：调用 AI 模型生成回复，支持流式响应、工具调用、图片生成等多种模式。
- **继续生成**（`generateMore`）：在当前消息后继续生成新回复。
- **分叉生成**（`regenerateInNewFork` / `saveAndResendMessage`）：以前驱消息为 pivot 把旧回复存入分支后生成；编辑重发（Save & Resend）会把原始提问连同旧回复一起留在分支里，编辑后的内容以新消息进入活跃路径。

---

## 自动命名

`naming.ts` 负责会话和线程的自动命名，采用防抖策略避免高频调用：

- **触发时机**：用户发送消息后，系统根据对话内容自动生成描述性名称。
- **防抖控制**：通过 `state.ts` 中的 `pendingNameGenerations`（Map）和 `activeNameGenerations`（Set）管理待执行和正在执行的命名请求，避免重复调用。
- **双层命名**：`scheduleGenerateNameAndThreadName` 同时生成会话名称和线程名称；`scheduleGenerateThreadName` 仅生成线程名称。

---

## 会话导出

`export.ts` 提供 `exportSessionChat` 函数，将会话内容（包括消息历史和元信息）导出为文件，方便用户备份或分享对话内容。

---

## 参考资料

- 模块拆分方案：[`docs/session-module-split-plan.md`](../session-module-split-plan.md)
- 新会话机制设计：[`docs/new-session-mechanism.md`](../new-session-mechanism.md)
- 关键决策记录：[`./key-decisions.md`](./key-decisions.md)（决策 #10、#11）
- Session 模块源码：[`src/renderer/stores/session/`](../../src/renderer/stores/session/)
- 公共 API 定义：[`src/renderer/stores/session/index.ts`](../../src/renderer/stores/session/index.ts)
