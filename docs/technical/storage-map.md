# App 存储地图

> 核对基线：2026-09-08，`main` 的 `ef853b26d`。描述源码接入情况，不代表正式版发布或原位升级验收。

Chatbox 使用多种本地存储。一份业务数据有自己的名字（key），平台决定它落在哪种介质；一个聊天又会拆成目录、会话记录、消息和附件。IndexedDB 是浏览器引擎管理的本地数据库，Electron 使用它并不意味着数据存到云端。

## 业务分类与平台介质

| 业务数据 | Desktop | Web | Capacitor Mobile | React Native Mobile |
|---|---|---|---|---|
| `settings` / `configs` / `configVersion` | `config.json` | IndexedDB `chatboxstore` | SQLite 主 KV | SQLite 主 KV |
| 其他通用业务 key | IndexedDB `chatboxstore` | IndexedDB `chatboxstore` | SQLite 主 KV | SQLite 主 KV |
| 会话目录 | IndexedDB `chatbox-session-meta` | 同 Desktop | SQLite 会话目录库 | 同名 SQLite 库 |
| 消息行 | IndexedDB `chatbox-messages` | 同 Desktop | SQLite 消息库 | 同名 SQLite 库 |
| 图片生成记录 | IndexedDB `chatbox-image-generation` | 同 Desktop | SQLite 生图库 | 同名 SQLite 库 |
| 图片、附件和解析内容 | `chatbox-blobs/` 文件 | 默认 localforage 实例 | WebView 默认 localforage 实例 | `chatbox-blobs-v1/` 文件 |
| 账号登录与轻量状态 | localStorage | localStorage | localStorage | AsyncStorage（宿主自己的状态集合） |
| 本地知识库、附件检索 | 原生 SQLite 与向量索引 | 不使用桌面实现 | 不使用桌面实现 | 不使用桌面实现 |

localforage 是异步存储封装，当前 Web / Capacitor 的附件没有显式指定驱动或数据库名；通常使用默认 IndexedDB，不能把它误认为主 KV 的 `chatboxstore`。浏览器存储的配额和清理策略取决于宿主。

Desktop 只有三个通用 key 被分流到文件：`settings`、`configs`、`configVersion`。其他通用 key（例如自定义助手和 Agent 记忆）在 `chatboxstore`。localStorage 与上述存储并行存在；历史 `LocalStorage` 迁移适配器停用，不等于浏览器 localStorage 停用。

RN 当前组装采用 Capacitor-compatible SQLite。相同文件名和 schema 不证明 Capacitor 已安装应用可原位升级到 RN，目录与应用身份仍是独立边界。


## 关键 key 与业务含义

### 通用业务 KV

| key | 内容 |
|---|---|
| `settings` | 服务商与模型配置、API Key / Provider OAuth 等凭据、语言主题、代理、MCP 等；服务商配置在 `providers` 下 |
| `configs` | 当前主要是安装实例 `uuid` |
| `configVersion` | 数据迁移版本，不是 App 版本号 |
| `session:<id>` | 旧格式完整 Session，或带 `storageFormat: 'rows'` 的会话记录 |
| `myCopilots` | 自定义助手列表：提示词、头像、背景、收藏等 |
| `agent-soul` / `agent-memories` | 全局 Agent 人设与记忆 |
| `copilot-memories` | 助手自己的记忆 |
| `copilot-memory-owners` / `copilot-memory-state-tokens` | 记忆归属与状态标识 |
| `remoteConfig` | 远端配置缓存 |
| `onboarding` | 引导流程状态 |

收藏按业务保存：会话是 meta 的 `starred`，助手是 `myCopilots` 条目的 `starred`，模型是 `settings.favoritedModels`。

### 登录与界面状态

Renderer 的下列 key 使用 localStorage：

| key | 内容 |
|---|---|
| `chatbox-ai-auth-info` | Chatbox 账号 accessToken / refreshToken；与 `settings.providers` 的模型凭据分开 |
| `ui-store` | 部分界面偏好与新会话默认选项，不是整个内存状态 |
| `_currentSessionIdCachedAtom` | 上次选中的会话 |
| `draft-<sessionId>` / `new-chat` | 会话 / 新聊天的输入草稿 |
| `input-box-history` | 输入历史 |
| `last-used-model` / `recent-directories` | 最近模型 / 工作目录 |
| `chatbox-message-queue-state` | 待发送消息队列状态 |
| `translation-cache` | 翻译缓存 |
| `initial-theme` / `collapsedProviders` | 启动主题 / 服务商折叠状态 |

RN 使用带命名空间的 AsyncStorage，例如 `@chatbox/v1:auth-info:chatbox-ai-auth-info`、`@chatbox/v1:last-used-model:last-used-model`；不能将 renderer 的全部 localStorage key 直接套用于 RN。

`StorageKey` 枚举不是当前存储的完整清单：`chat-sessions`、`chat-sessions-list` 属于历史会话组织结构；`authInfo` 不是当前账号 store 的实际 key；`chat-session-settings`、`picture-session-settings` 在备份兼容路径中仍有意义，当前单会话设置随会话保存。


## 会话目录、记录与消息行

| 层 | Desktop / Web | SQLite 宿主 | 内容 |
|---|---|---|---|
| 通用记录 | `chatboxstore` | `chatboxSQLite.db` 的 `key_value` | `session:<id>` 等业务 key |
| 会话目录 | `chatbox-session-meta` 的 `records` | `chatbox-session-metaSQLite.db` 的 `session_meta` | 标题、排序、收藏、归档、图片引用等 |
| 线程和消息 | `chatbox-messages` 的 `threads` / `messages` | `chatbox-messagesSQLite.db` 的 `session_threads` / `session_messages` | 历史线程、消息正文、父子与选中分支关系 |
| 生图记录 | `chatbox-image-generation` 的 `records` | `chatbox-image-generationSQLite.db` 的 `image_generation` | prompt、model、status、taskId、图片 storage key |

目录是展示侧栏所需的信息，不包含完整消息正文。生图记录保存任务与图片引用，图片内容走附件库。

V1 将完整 Session JSON 保存在 `session:<id>`。rows 格式在该 key 保存瘦记录和读取投影，正文拆到消息行。消息以 `sessionId` / `messageId` 定位，`threadId` 表示线程，`parentMessageId` 表示父消息，`activeChildId` 表示当前选择的后续分支。线程保存当前叶子、压缩边界等。行库还保存提交版本和提交记录，避免并发写入覆盖。

SQLite 另有 `session_message_payload_chunks`、revision head、staging 等内部表，负责分块与可靠提交；`session_text_tokens` 保存文本 token 派生数据。Capacitor 主 KV 的 `key_value_chunks` 与消息正文分块是两套机制。

行存储支持按需读取，但不保证所有操作只读少量消息：聊天首屏满足条件时读取最近 50 条；复杂会话回退完整读取；模型上下文沿父链读取；导出读取完整会话。详细条件与迁移协议见 [存储架构](./storage.md#会话行存储与读取范围)。

证据：[消息结构](../../packages/chatbox-core/src/session/session-tree/types.ts)、[SQLite schema](../../packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts)、[IndexedDB 行库](../../src/renderer/storage/SessionRowStorage.ts)。

## 附件、知识库与文件

一条“总结 PDF”的消息会保存文件名和 `storageKey`，附件库保存解析文本，存在 `rawStorageKey` 时还可定位原附件；KV 保存 token 统计和解析信息；桌面附件检索另存文本切片和向量。向量是用于匹配相关内容的数字表示。

| key 模式 | 用途 |
|---|---|
| `picture:<category>:<uuid>` | 图片、头像等内容 |
| `file:<sessionId>:<msgId>:<uuid>` | 消息关联的文件内容 |
| `file:<路径或文件名>-<size>-<lastModified>` | 文件解析缓存 |
| `link:<url>` | 网页解析内容 |
| `*_tokenMap` / `*_parserType` | 相关 token 统计与解析信息，走 KV |

Blob 是大内容接口，不保证值是 JavaScript Blob：当前可能保存文本或 data URL。Desktop 写 UTF-8 文件到 `<userData>/chatbox-blobs/<sanitized key>`；RN 使用 `Documents/chatbox-blobs-v1/objects/<hash前2位>/<sha256(key)>.blob`。

| 桌面路径（相对 userData） | 业务 |
|---|---|
| `config.json` / `config-backup-*.json` | 配置与配置副本 |
| `chatbox-blobs/` | 图片、附件和解析内容 |
| `chatbox-databases/chatbox_kb.db` | 知识库；`knowledge_base`、`kb_file` 与向量索引 |
| `chatbox-databases/chatbox_session_rag.db` | 对话附件检索；`session_attachment`、`session_attachment_parent`、`session_attachment_chunk` |
| `chatbox-databases/chatbox_session_rag_vectors.db` | 对话附件向量索引 |
| `skills/` | 安装的 Skills 及资源 |
| `chatbox-sandbox/artifacts/` | 工作模式保存的产物 |
| `command-output/` | 短期保留的命令输出 |

默认 macOS userData 为 `~/Library/Application Support/xyz.chatboxapp.app/`，Windows 为 `%APPDATA%/xyz.chatboxapp.app/`，启动参数或宿主配置可改变目录。浏览器引擎的 IndexedDB / localStorage 也由用户配置目录管理，不能仅复制上表文件就视为完整数据备份。

知识库与聊天附件检索是独立业务。`kb_file.filepath` 可以指向用户原文件路径，不能承诺知识库已将所有原文件复制进 App。向量索引属于落盘的派生数据，与 React Query 内存缓存不同。Skills 还可以读取外部目录；工作模式临时目录位于系统 temp，生命周期与持久产物不同。


## 缓存与备份边界

React Query、Jotai / Zustand 的内存值不是独立的最终持久化来源；只有明确接入存储的字段才会保留。草稿、翻译缓存、检索索引虽然都是辅助数据，也可能落盘。Renderer 还通过 `chatboxkeypair` localforage 实例记录 App Store 评分提示状态；通用 `chatboxcache` 是否持久化取决于运行时，有内存回退。

配置自动备份只复制 `config.json`，不含完整聊天和附件。应用内便携备份按所选设置、密钥、会话、助手导出，完整会话在 `sessions/<id>/session.json`，引用资源按 manifest 收集；rows 会被还原为完整 Session。导出结果中的资源读取失败等 warning 仍需检查。

便携备份不是用户目录镜像：不直接打包知识库 / RAG 数据库、Skills 目录、工作模式产物和日志。迁移、恢复或清理前，应按目标业务确认所需数据，不能把“复制配置文件”“复制消息库”“应用备份”视为等价。

证据：[备份结构](../../packages/chatbox-core/src/backup/archive-layout.ts)、[备份选择](../../packages/chatbox-core/src/backup/export-items.ts)、[导出实现](../../packages/chatbox-core/src/backup/export-backup.ts)、[辅助缓存](../../src/shared/utils/cache.ts)。
