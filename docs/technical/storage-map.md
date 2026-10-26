# App 存储地图

> Last updated: 2026-10-20
>
> 描述当前开发代码的存储边界，不代表正式版发布或跨应用原位升级验收。

Chatbox 使用多种本地存储。一份业务数据有自己的名字（key），平台决定它落在哪种介质；一个聊天又会拆成目录、会话记录、消息和附件。IndexedDB 是浏览器引擎管理的本地数据库，Electron 使用它并不意味着数据存到云端。

## 业务分类与平台介质

| 业务数据 | Desktop | Web | Capacitor Mobile | React Native Mobile |
|---|---|---|---|---|
| `settings` / `configs` / `configVersion` | `config.json` | IndexedDB `chatboxstore` | SQLite 主 KV | SQLite 主 KV |
| 其他通用业务 key | IndexedDB `chatboxstore` | IndexedDB `chatboxstore` | SQLite 主 KV | SQLite 主 KV |
| 会话目录 | IndexedDB `chatbox-session-meta` | 同 Desktop | SQLite 会话目录库 | 同名 SQLite 库 |
| 消息行 | IndexedDB `chatbox-messages` | 同 Desktop | SQLite 消息库 | 同名 SQLite 库 |
| 图片生成记录 | IndexedDB `chatbox-image-generation` | 同 Desktop | SQLite 生图库 | 同名 SQLite 库 |
| 图片、附件和解析内容 | `chatbox-blobs/` 文件 | 默认 localforage 实例 | 默认 localforage 实例 | `chatbox-blobs-v1/` 文件 |
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
| `session:<id>` | 旧格式完整 Session；迁移到行存储后保持原样，供降级后的 v1.23 读取 |
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

`StorageKey` 枚举不是当前存储的完整清单：`chat-sessions`、`chat-sessions-list` 属于历史会话组织结构；`authInfo` 不是当前账号 store 的实际 key；`chat-session-settings`、`picture-session-settings` 是历史设置 key，当前单会话设置随会话保存。


## 会话目录、记录与消息行

| 层 | Desktop / Web | SQLite 宿主 | 内容 |
|---|---|---|---|
| 通用记录 | `chatboxstore` | `chatboxSQLite.db` 的 `key_value` | `session:<id>` 等业务 key |
| 会话目录 | `chatbox-session-meta` 的 `records` | `chatbox-session-metaSQLite.db` 的 `session_meta` | 标题、排序、收藏、归档、图片引用等 |
| 线程和消息 | `chatbox-messages` 的 `threads` / `messages` | `chatbox-messagesSQLite.db` 的 `session_threads` / `session_messages` | 历史线程、消息正文、父子与选中分支关系 |
| 生图记录 | `chatbox-image-generation` 的 `records` | `chatbox-image-generationSQLite.db` 的 `image_generation` | prompt、model、status、taskId、图片 storage key |

目录是展示侧栏所需的信息，不包含完整消息正文。生图记录保存任务与图片引用，图片内容走附件库。

旧版完整 Session JSON 位于 `session:<id>`，是行迁移的输入。迁移、后续编辑和恢复都不改写它：降级安装的 v1.23 仍从这里读取升级前的会话；只有删除会话时连同目录记录一起删除。新版附件清理只按行数据判断引用，不扫描这些旧记录；目录内会话缺少有效行提交，或目录快照外的会话仍有 `session:<id>` 旧记录（尚未迁移或迁移中，行可能先于目录记录发布）时，整次清理放弃删除；快照后新建目录记录的会话留待下一次扫描，只剩行数据、既无旧记录也无目录记录的会话（例如在 v1.23 中删除的会话）不阻塞清理。只被旧记录引用的附件（例如升级后删除的图片）会被清理，降级后 v1.23 中对应位置的附件可能缺失。升级后新建的会话没有这个 key。正常会话通过独立 header、线程和消息行访问；目录服务于列表，消息库的提交头保存权威会话记录、正文及关系。消息以 `sessionId` / `messageId` 定位，`threadId` 表示线程，`parentMessageId` 表示父消息，`activeChildId` 表示当前选中的后续分支；线程保存当前叶子和压缩边界。

每条消息保存一个完整 `Message`：IndexedDB 的 `messages` 行持有完整对象，SQLite 的 `session_messages.message_json` 持有完整 JSON。正文不按大小切换持久化格式。分页在消息边界结束，超过页目标预算的单条消息单独处理；桥接请求可以切片传输同一行文本，但不会生成正常消息分片表。Capacitor 主 KV 的 `key_value_chunks` 属于通用 KV 存储，与消息行格式独立。

revision head、staging 和提交记录负责冲突检测与原子发布；`session_text_tokens` 等索引保存派生数据。复制会话和历史线程迁出使用正常 `iterateRows` / `stageRows` 接口：源读取绑定 revision，目标候选隐藏写入，校验后以 CAS 原子发布。普通资源扫描通过行接口逐条收集引用，不构造完整会话正文。

本地升级入口将正式发布版本的完整 Session 转换为规范行，验证候选后原子发布。资源 GC 通过普通行接口扫描引用，遇到扫描失败或并发状态变化时保留资源。

聊天窗口、导航、Token 和生成上下文使用各自的行查询。单会话文本/HTML/JSON 输出使用普通聊天导出接口；完整输出文件可能仍需内存缓冲。详细边界见 [存储架构](./storage.md#会话行存储与读取范围)。

证据：[消息结构](../../packages/chatbox-core/src/session/session-tree/types.ts)、[SQLite schema](../../packages/chatbox-core/src/persistence/capacitor-compatible-schema.ts)、[IndexedDB 行库](../../src/renderer/storage/SessionRowStorage.ts)、[行传输接口](../../packages/chatbox-core/src/ports/session-row-transfer.ts)。

## 附件、知识库与文件

一条“总结 PDF”的消息会保存文件名和 `storageKey`，附件库保存解析文本，存在 `rawStorageKey` 时还可定位原附件；KV 保存 token 统计和解析信息；桌面附件检索另存文本切片和向量。向量是用于匹配相关内容的数字表示。

| key 模式 | 用途 |
|---|---|
| `picture:<category>:<uuid>` | 图片、头像等内容 |
| `file:<sessionId>:<msgId>:<uuid>` | 消息关联的文件内容 |
| `file:<路径或文件名>-<size>-<lastModified>` | 文件解析缓存 |
| `link:<url>` | 网页解析内容 |
| `*_tokenMap` / `*_parserType` | 相关 token 统计与解析信息，走 KV |

Blob 是普通资源存储接口，不保证值是 JavaScript Blob：当前可能保存文本或 data URL。Desktop 写 UTF-8 文件到 `<userData>/chatbox-blobs/<sanitized key>`；RN 使用 `Documents/chatbox-blobs-v1/objects/<hash前2位>/<sha256(key)>.blob`，文件封装保存原 key、编码与字节数。

Web 与 Capacitor 通过 localforage 读写资源字符串；RN Blob owner 读写 `CBLOB1` 文件。资源存储不依赖归档模块。`@chatbox/core/resources` 收集消息、header、设置和 Copilot 的受管资源引用；宿主 GC 还保护草稿、近期写入和生图记录，并在扫描不完整时放弃删除。

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

配置自动备份只复制 `config.json`，不含完整聊天和附件。当前开发阶段的整包备份导入、导出入口显示暂不可用；设置页不能触发文件选择或归档任务。会话列表恢复、单会话聊天输出和平台诊断日志各有独立入口，RN 未接入日志输出的操作显示不可用。

数据库升级和会话列表恢复不是归档导入：前者转换当前磁盘记录，后者重建目录投影。复制配置文件、复制消息库也不能代替完整用户数据迁移。新的 V3 归档及 V1/V2 文件适配按 [备份功能边界](./data-backup.md) 所列阶段交付。

