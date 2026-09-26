# Chatbox 移动端本地向量 RAG 魔改项目文档

**项目代号：** Mobile Local RAG（MLRAG）  
**文档版本：** v0.1.0  
**状态：** 正式开工  
**基线日期：** 2026-09-26  
**目标平台：** Android + iOS  
**上游项目：** `chatboxai/chatbox` Community Edition  
**开源许可证：** GPLv3

---

## 1. 项目结论

本项目的目标不是重新开发一个独立 RAG 软件，而是在 Chatbox 现有“Session Attachment RAG”架构上，增加一套**移动端本地实现**，让 Android 与 iOS 在不依赖 NAS、不要求官方集中式向量数据库的情况下，对用户自己的大文件附件执行本地向量检索。

核心路线确定为：

> **复用现有 Session Attachment RAG 的数据结构、分块逻辑、查询协议和工具调用；新增 Mobile Controller + Mobile Local RAG Engine；向量索引保存在用户设备；Embedding 默认使用用户已配置的 Embedding API，后续再增加真正端侧 Embedding。**

当前用户的测试 KB 已从约 77.5 MB 缩减到**约 18 MB**。18 MB 已经非常适合作为第一阶段验证数据，因此项目第一阶段不再以“超大 KB 兼容”为目标，而以“18 MB KB 在 Android/iOS 上稳定建立本地索引并完成语义检索”为硬验收标准。

---

## 2. 需求与约束

### 2.1 核心需求

| 项目 | 要求 |
|---|---|
| Android | 必须支持 |
| iOS | 必须支持 |
| 本地向量索引 | 必须支持 |
| 服务器/NAS依赖 | **禁止作为架构依赖** |
| 用户规模 | 面向大量用户，不允许依赖个人设备/个人 NAS |
| 18 MB KB | 首个硬验收目标 |
| 原有 Chatbox 聊天体验 | 尽量不改变 |
| 原有 Desktop RAG | 不破坏 |
| RAG 工具协议 | 尽量复用 |
| Embedding | 第一阶段允许使用用户配置的 API |
| 本地 Embedding | 第二阶段再做，不作为 MVP 阻塞项 |
| Rerank | MVP 非必须，后续可插拔 |
| 数据隐私 | KB 与向量索引默认留在用户设备 |
| 断点续建 | 必须支持 |
| App 重启后索引保留 | 必须支持 |

### 2.2 明确不采用

1. 不把 NAS 作为正式架构依赖。
2. 不建立“所有用户上传 KB → 官方服务器 → 官方统一向量库”的集中式架构。
3. 不重写整个 Chatbox Knowledge Base。
4. 不在第一阶段同时开发本地 Embedding、向量数据库、Rerank 三个复杂子系统。
5. 不把整份 18 MB KB 每轮直接塞进模型上下文。

---

## 3. 上游源码调研结论

### 3.1 Chatbox 当前已经存在真实的 Session Attachment RAG

当前桌面端的 Session Attachment RAG 已经具备完整链路：

```text
附件
  ↓
解析
  ↓
Parent / Child 分块
  ↓
Embedding
  ↓
LibSQLVector
  ↓
向量召回
  ↓
可选 Rerank
  ↓
Top-K
  ↓
Parent 回读
  ↓
模型工具输出
```

核心源码包括：

- `src/main/session-attachment-rag/chunking.ts`
- `src/main/session-attachment-rag/file-loaders.ts`
- `src/main/session-attachment-rag/db.ts`
- `src/main/session-attachment-rag/model-providers.ts`
- `src/main/session-attachment-rag/ipc-handlers.ts`
- `src/renderer/platform/session-attachment-rag/interface.ts`
- `src/renderer/platform/session-attachment-rag/desktop-controller.ts`
- `src/renderer/packages/model-calls/toolsets/session-attachment-rag.ts`

### 3.2 移动端明确没有实现 Session Attachment RAG

当前 `MobilePlatform`：

```ts
public getSessionAttachmentRagController(): SessionAttachmentRagController {
  throw new Error('Session attachment RAG is not implemented on mobile.')
}
```

同时：

```ts
public readonly isDesktopLike = false
```

而当前 feature flags 又要求：

```ts
knowledgeBase: platform.isDesktopLike
```

因此移动端不是“向量搜索偶尔没开”，而是当前架构设计上主动没有接入 Desktop RAG。

### 3.3 移动端已经有原生 SQLite

当前项目已经引入并使用：

- `@capacitor-community/sqlite`
- Android 原生 SQLite
- iOS 原生 SQLite

移动端已经存在 `MobileSQLiteStorage`、`SQLiteSessionMetaStorage` 等数据库封装。

因此本项目不需要重新引入一套完全不同的移动端数据库框架。

### 3.4 当前移动端已经可以本地解析文件

`MobilePlatform` 已通过 `parseFileLocallyInBrowser()` 完成本地文本解析，并将解析结果写入本地 Blob Storage。

所以我们只需要把“解析后的文本”接到 Mobile RAG Indexer，不需要重写整个文件选择/解析链。

### 3.5 当前普通文件搜索不是向量 RAG

现有 `search_file_content` 是逐行 `includes()` 搜索，最多返回 100 个匹配结果；`read_file` 一次默认读取 200 行，单次最多 500 行。

这可以解释移动端目前观察到的“会搜索关键词”，但它不是语义向量检索。

### 3.6 当前 Desktop Session RAG 的关键参数

当前上游分块参数：

- Parent 目标：1600 字符
- Parent 硬上限：2400 字符
- Child：448 字符
- Child overlap：64 字符

当前查询参数：

- Recall：Top 20
- Final：默认 Top 8，允许到 12
- Rerank：可选

Embedding：

- 批处理 50 个 Chunk
- 支持中断后继续
- 保存 embedding 模型和向量维度信息

这套设计可以直接作为 Mobile MVP 的行为基线。

---

## 4. 当前源码中对本项目最重要的阻塞点

### 4.1 6 MB 解析内容限制

当前 Session Attachment RAG 在 `sessionHelpers.ts` 中有：

```ts
SESSION_ATTACHMENT_RAG_MAX_PARSED_BYTE_LENGTH = 6 * 1024 * 1024
```

如果解析后的内容超过这个限制，则不会进入当前的 Session RAG 路径。

而本项目测试 KB 约 18 MB，因此**如果不修改这里，18 MB KB 无法按目标方式进入 Mobile RAG**。

处理原则：

- 不简单把所有文件的限制无限放大。
- 单独为 Session RAG 引入可配置的“大文件 RAG 允许上限”。
- 第一阶段至少保证 18 MB 成功。
- 推荐先把移动端 RAG 上限设为 64 MB，并保留后续可调整能力。
- 大于上限时仍可回落到普通附件/文件工具机制，而不是直接崩溃。

### 4.2 Desktop RAG 依赖 Electron Main Process

Desktop 当前是：

```text
Renderer
  ↓
Electron IPC
  ↓
Main Process
  ↓
SQLite + LibSQLVector
```

移动端没有 Electron Main Process，因此不能把 DesktopController 原样复制过去。

正确做法：

```text
SessionAttachmentRagController
       ├── DesktopController
       └── MobileController
```

保持上层接口不变。

---

## 5. 目标架构

```text
                         Chatbox Mobile
                              │
                       Attachment Pipeline
                              │
                   parse + analyze + store
                              │
                              ▼
                SessionAttachmentRagController
                              │
                       MobileController
                              │
                              ▼
                    MobileLocalRagEngine
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
     Chunker              Embedding             Vector Store
        │                     │                     │
    Parent/Child      user-configured API      local device
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                        Local Vector Search
                              │
                            Top 20
                              │
                        Optional Rerank
                              │
                          Final Top 8
                              │
                        Parent Read-back
                              │
                              ▼
                   Existing Session RAG Tools
                              │
                              ▼
                             LLM
```

### 5.1 架构原则

**原则 A：移动端与 Desktop 共用接口。**  
不修改 `SessionAttachmentRagController` 的核心语义。

**原则 B：RAG 数据本地化。**  
原始文本、Chunk、向量、索引状态默认储存在本机。

**原则 C：Embedding 与 Vector Store 解耦。**  
未来可以把 Embedding API 换成本地模型，而不用重写数据库。

**原则 D：向量数据库可替换。**  
第一版允许使用简单实现做验证，后续可切到 SQLite 原生向量扩展。

**原则 E：LLM 不负责“自己翻 18 MB 文件”。**  
模型必须通过 `query_session_attachment` 获取相关片段。

---

## 6. 移动端数据库方案

### 6.1 MVP 数据库

直接使用项目现有 `@capacitor-community/sqlite`。

建议新增独立数据库：

```text
chatbox-session-rag.db
```

不要直接污染现有：

```text
chatbox.db
chatbox-session-meta
chatbox-image-generation
```

### 6.2 建议表结构

```sql
CREATE TABLE session_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL,
  token_estimate INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  indexing_stage TEXT,
  total_chunks INTEGER DEFAULT 0,
  embedded_chunks INTEGER DEFAULT 0,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  created_at INTEGER,
  completed_at INTEGER,
  error TEXT
);

CREATE TABLE session_attachment_parent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id INTEGER NOT NULL,
  parent_order INTEGER NOT NULL,
  section_path TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER,
  char_count INTEGER
);

CREATE TABLE session_attachment_chunk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id INTEGER NOT NULL,
  parent_id INTEGER NOT NULL,
  chunk_order INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  embedded_text TEXT NOT NULL,
  token_estimate INTEGER
);

CREATE TABLE session_attachment_vector (
  chunk_id INTEGER PRIMARY KEY,
  vector BLOB NOT NULL
);
```

### 6.3 Vector Store 后端策略

第一阶段必须定义抽象：

```ts
interface LocalVectorStore {
  createIndex(indexId: string, dimension: number): Promise<void>
  upsert(items: VectorRecord[]): Promise<void>
  query(indexId: string, vector: number[], topK: number): Promise<VectorHit[]>
  deleteIndex(indexId: string): Promise<void>
}
```

MVP 先实现：

```text
SQLite BLOB + 分批余弦相似度扫描
```

原因：

- 改动最少
- 不增加新的原生插件依赖
- Android/iOS 都能使用
- 足以验证 18 MB KB 的真实效果

性能若不能达到目标，再切换到 SQLite 原生向量扩展，不改变上层接口。

---

## 7. 后续向量引擎升级路线

目前社区生态已经存在能够运行在移动设备上的 SQLite 向量扩展，例如 sqlite-vec，以及专门面向移动/边缘场景的 SQLite-Vector；后者明确提供 Android/iOS 预构建包。sqlite-vec 官方同时说明它目前仍处于 pre-v1 阶段，因此不应该让 MVP 直接强绑定某一个第三方扩展。

升级条件建议设为：

```text
若移动端真实测试满足任一条件：
- 召回 p95 > 500 ms
- 单次查询产生明显 UI 卡顿
- 内存峰值 > 150 MB
- KB 达到 100 MB 以上

则启用 NativeVectorStore 后端。
```

这样项目不会因为“为了未来性能”而提前引入大量原生代码。

---

## 8. Embedding 策略

### 8.1 MVP：使用用户配置的 Embedding API

不把官方 Embedding 服务设成项目架构硬依赖。

用户可以使用自己的 Embedding Provider。

推荐保留类似：

```text
provider:model
```

作为索引身份的一部分。

例如：

```text
openai:text-embedding-3-small
```

建立索引时记录：

```text
embeddingModel
embeddingDimension
```

查询时必须检查 Query Embedding 与 Index 的模型/维度兼容性。

### 8.2 模型更换规则

如果用户把 Embedding 模型从 A 换成 B：

```text
旧索引 ≠ 新索引
```

必须重新建库，不能混用两个模型的向量。

### 8.3 第二阶段：端侧 Embedding

后续增加：

```text
Embedding Mode
├── 用户 API
└── On-device
```

端侧模型不应进入 MVP，因为模型体积、NPU/CPU、iOS/Android 原生推理、量化与安装包体积都会显著增加项目复杂度。

---

## 9. 分块策略

MVP 尽量复用上游参数，不另造一套：

```text
Parent target      1600 chars
Parent hard cap    2400 chars
Child size          448 chars
Child overlap        64 chars
```

对于 Markdown / JSON / JSONL 等结构化文件继续使用结构化 Chunking；普通文本使用 Plain Chunking。

### 9.1 为什么保留 Parent/Child

向量检索应该命中 Child：

```text
问题 → Child 2 命中
```

再回读 Parent：

```text
Child 2
  ↓
Parent 7
  ↓
更完整上下文
```

这样既保留召回精度，又不会把过碎的句子直接扔给模型。

---

## 10. 查询策略

MVP 完全复用上游查询协议：

```text
用户问题
  ↓
Embedding
  ↓
Recall Top 20
  ↓
按 Parent 去重
  ↓
Final Top 8
  ↓
read_session_attachment_parents
  ↓
模型
```

Rerank：

```text
MVP：关闭
V1：可选
```

以后可以实现：

```text
Top 20
  ↓
Rerank
  ↓
Top 8
```

而不用改变模型工具协议。

---

## 11. 18 MB KB 的专门设计

### 11.1 必须满足

```text
18 MB KB
 ↓
Android 导入
 ↓
完整解析
 ↓
建立 Chunk
 ↓
Embedding
 ↓
本地持久化
 ↓
App 重启
 ↓
索引仍可用
```

iOS 同样执行。

### 11.2 不得出现

- 因 6 MB 旧限制退回全文上下文。
- 因索引耗时导致 UI 长时间卡死。
- App 关闭后全部索引丢失。
- 每次发送消息都重新 Embedding 整个 KB。
- 更换聊天消息后重新建立整个 KB。

### 11.3 索引任务必须可恢复

状态沿用：

```text
pending
 ↓
indexing
 ↓
ready
```

失败：

```text
failed
 ↓
retry
```

索引至少保存：

```text
已完成 Chunk 数
总 Chunk 数
Embedding 模型
Embedding 维度
索引阶段
```

---

## 12. 代码修改计划

### M0：基线冻结

先记录上游 Git commit SHA，并从该 commit 建立独立开发分支：

```text
feature/mobile-local-rag
```

不要直接长期跟踪 mutable `main`。

### M1：共享层抽取

目标：把 Desktop RAG 中与 Node/Electron 无关的逻辑拆成可共享模块。

优先处理：

```text
chunking.ts
shared types
query plan
result format
```

不动业务语义。

### M2：Mobile Controller

新增：

```text
src/renderer/platform/session-attachment-rag/mobile-controller.ts
```

实现：

```text
create()
getAttachments()
retryAttachment()
deleteAttachment()
query()
readParents()
getDebugSnapshot()
clearAll()
runMaintenance()
```

### M3：Mobile Local RAG Engine

建议目录：

```text
src/renderer/platform/session-attachment-rag/mobile/
  engine.ts
  db.ts
  vector-store.ts
  indexer.ts
  embedding.ts
  maintenance.ts
```

### M4：MobilePlatform 接入

把：

```ts
throw new Error('Session attachment RAG is not implemented on mobile.')
```

替换成真正的 `MobileController`。

同时加入初始化与生命周期管理。

### M5：18 MB 限制处理

调整 `sessionHelpers.ts` 的 RAG 大文件判定，让 18 MB 文件能够进入 `session-retrieval`。

注意：不能破坏普通附件行为。

### M6：模型工具接通

尽量保持现有：

```text
list_session_attachments
query_session_attachment
read_session_attachment_parents
```

不重新发明 Tool API。

### M7：Android/iOS 双端验证

同一套 KB、同一套查询集分别测试：

```text
Android
 iPhone/iPad
```

要求行为一致。

---

## 13. 建议新增的调试能力

移动端开发阶段增加 Debug Snapshot：

```text
RAG 数据库大小
附件数量
Parent 数量
Child 数量
向量数量
索引模型
向量维度
索引状态
已完成/总 Chunk
最近错误
最近查询耗时
```

同时记录：

```text
parse_ms
chunk_ms
embedding_ms
persist_ms
query_embedding_ms
vector_search_ms
rerank_ms
parent_read_ms
total_query_ms
```

这样可以真正回答：

> “手机端到底索引了什么、检索了多少、花了多长时间？”

---

## 14. RAG 评测方案

本项目不能只用“感觉好不好”评价。

需要建立固定测试集，至少覆盖以下类型：

### A. 精确实体

```text
某人物的当前境界？
某蛊虫的具体效果？
某事件发生在哪一阶段？
```

### B. 语义改写

```text
“方源现在实力大概是什么级别？”
```

测试是否能检索到“境界/战力/修为”等不同措辞的内容。

### C. 跨章节

测试一个问题需要多个区域知识才能回答的情况。

### D. 易混淆实体

例如：

```text
相近人物名
相近蛊虫名
相近流派名
```

### E. 时间线

测试：

```text
此时
之前
之后
当前阶段
已经发生/尚未发生
```

### F. 反幻觉

测试 KB 没有资料时，模型是否能够表现为“没有检索到足够资料”，而不是凭空生成不存在的蛊虫、流派或事件。

---

## 15. MVP 验收标准

### 功能验收

- [ ] Android 可以导入 18 MB KB
- [ ] iOS 可以导入 18 MB KB
- [ ] 首次可建立完整向量索引
- [ ] App 重启后索引仍存在
- [ ] 索引过程可显示状态
- [ ] 索引失败可以继续/重试
- [ ] 删除附件同时删除向量数据
- [ ] 更换 Embedding 模型不会错误复用旧向量
- [ ] 查询可以返回 Top 20 候选
- [ ] 最终返回默认 Top 8
- [ ] 可以根据命中的 Parent 回读完整上下文
- [ ] AI 使用现有 Session Attachment 工具完成检索
- [ ] 不需要 NAS/个人服务器

### 上下文验收

- [ ] 18 MB KB 不被整体注入 Prompt
- [ ] 查询只把相关检索结果交给模型
- [ ] 与普通 `search_file_content` 明确区分
- [ ] 检索结果包含来源文件/章节/Parent 信息

### 性能验收

第一阶段暂定目标：

- 单次普通查询端到端 p95 < 2 秒（不含外部 LLM 生成时间）
- 向量搜索本身 p95 < 500 ms
- UI 主线程无明显卡顿
- 索引过程不阻塞正常聊天 UI

这些是工程目标，不是上游现有保证；实际数值以真实 Android/iOS 测试为准。

---

## 16. 隐私与大规模用户策略

### 16.1 正式架构不依赖 NAS

NAS 只可作为开发者自己的测试工具，不进入产品架构、部署文档或用户安装要求。

### 16.2 正式架构不要求官方集中保存 KB

推荐：

```text
用户 KB
  ↓
用户设备
  ↓
本地索引
  ↓
本地检索
```

仅 Embedding API 请求可能离开设备，取决于用户选择的 Provider。

### 16.3 数据分层

```text
原文：本地
Chunk：本地
向量：本地
索引：本地
查询文本：按 Embedding Provider 策略处理
LLM 上下文：按用户选择的 LLM Provider 处理
```

UI 中应明确向用户说明：

> 使用云端 Embedding 时，参与建立索引的文本会发送给所选 Embedding 服务商。

后续有端侧 Embedding 时再提供“完全本地”模式。

---

## 17. 许可证与分发注意事项

当前 Community Edition 使用 GPLv3。

因此在正式分发修改后的 Chatbox Android/iOS 构建版本前，必须检查：

1. 修改版是否正确保留 GPLv3 通知。
2. 是否需要提供对应源代码或可获取方式。
3. 新增第三方原生库的许可证是否与 GPLv3 组合兼容。
4. Android/iOS 商店的分发条款与 GPLv3 对安装/修改权限相关要求是否存在额外问题。
5. 新增的本地 Embedding 模型本身是否有独立模型许可证。

本项目文档不把法律判断当作技术结论；发布前应单独完成许可证与商店政策审查。

---

## 18. 主要风险

| 风险 | 概率 | 影响 | 对策 |
|---|---:|---:|---|
| Capacitor SQLite 适配向量 BLOB 性能不足 | 中 | 中 | 先做 MVP，保留 NativeVectorStore 后端 |
| 18 MB 索引耗时过长 | 中 | 中 | 50 条一批、断点续建、后台任务 |
| Embedding API 失败/限流 | 中 | 中 | 重试、断点、清晰错误状态 |
| iOS/Android 生命周期导致任务中断 | 高 | 高 | checkpoint + resume |
| 更换 Embedding 模型造成维度冲突 | 中 | 高 | index identity 强绑定模型/维度 |
| 上游 Chatbox 更新造成接口漂移 | 高 | 中 | M0 固定 commit + shared interface tests |
| 第三方向量扩展引入原生构建复杂度 | 中 | 高 | MVP 不强依赖；性能达标后再上 |
| 用户用超大文件导致内存压力 | 中 | 中 | 分块、上限、警告、流式优化 |

---

## 19. 开发纪律

### 必须

- 先看现有代码再改。
- 不重复实现已有功能。
- 不破坏 Desktop RAG。
- 不修改现有 Tool API，除非有充分理由。
- 所有异步索引任务必须可取消/可恢复。
- 新增代码必须有单元测试。
- Android 与 iOS 至少做一次同数据集回归。

### 禁止

- 为了移动端直接复制整套 `src/main` 到 renderer。
- 为了快速跑通把整个 18 MB KB 注入 Prompt。
- 把 NAS 写进架构。
- 把单一云端 Embedding 服务写死成唯一方案。
- 把向量实现与某一个第三方数据库强耦合。
- 为了 MVP 直接引入端侧大模型。

---

## 20. 给编码 Agent 的开工指令

> 你正在修改 `chatboxai/chatbox` Community Edition，为其增加 Android/iOS 本地 Session Attachment Vector RAG。
>
> 目标：不重写 Chatbox 原有 RAG，不破坏 Desktop RAG，不增加 NAS/服务器依赖；复用现有 Session Attachment RAG 的接口、分块策略、查询 Tool 和 Parent/Child 数据模型。
>
> 开工顺序：
>
> 1. 固定当前上游 commit，建立 `feature/mobile-local-rag` 分支。
> 2. 阅读并理解：
>    - `src/renderer/platform/mobile_platform.ts`
>    - `src/renderer/platform/interfaces.ts`
>    - `src/renderer/platform/session-attachment-rag/interface.ts`
>    - `src/renderer/platform/session-attachment-rag/desktop-controller.ts`
>    - `src/main/session-attachment-rag/chunking.ts`
>    - `src/main/session-attachment-rag/file-loaders.ts`
>    - `src/main/session-attachment-rag/db.ts`
>    - `src/main/session-attachment-rag/ipc-handlers.ts`
>    - `src/renderer/packages/model-calls/toolsets/session-attachment-rag.ts`
>    - `src/renderer/stores/sessionHelpers.ts`
> 3. 提取可以跨平台复用的 chunking/shared types，不复制两套逻辑。
> 4. 新增 Mobile SessionAttachmentRagController。
> 5. 新增 MobileLocalRagEngine。
> 6. 使用项目现有 `@capacitor-community/sqlite` 创建独立 RAG 数据库。
> 7. MVP 向量存储先实现 SQLite BLOB + 分批相似度扫描，并设计 `LocalVectorStore` 接口；不要立即绑定第三方原生向量扩展。
> 8. Embedding 接口必须与向量存储解耦，索引必须记录 embeddingModel 和 embeddingDimension。
> 9. 把当前 6 MB RAG 解析限制调整为可配置的移动端 Session RAG 上限，至少让 18 MB 文本 KB 可以进入 session-retrieval。
> 10. 保持 `query_session_attachment` 和 `read_session_attachment_parents` 工具协议不变。
> 11. 首轮不实现 Rerank，不实现端侧 Embedding。
> 12. 先完成 Android + iOS 都可用的最小闭环，再做性能优化。
> 13. 每完成一个阶段都运行类型检查、相关单元测试，并明确报告改动文件。
>
> 首个里程碑只要求实现：
>
> ```text
> Android/iOS 导入 18 MB KB
> → 分块
> → Embedding
> → 本地持久化
> → App 重启后索引仍存在
> → Query Top20
> → Final Top8
> → Parent 回读
> → 通过现有 Session Attachment Tool 给模型
> ```
>
> 如果遇到架构选择，优先遵循：**最少改动、跨平台、可回滚、保持 Desktop 不变、无 NAS 依赖。**

---

## 21. 开工顺序总览

```text
M0  固定上游版本 + 基线测试
        ↓
M1  抽取共享 Chunk / Types
        ↓
M2  Mobile Controller
        ↓
M3  Mobile SQLite RAG DB
        ↓
M4  Indexer + Checkpoint
        ↓
M5  Embedding Adapter
        ↓
M6  Local Vector Search
        ↓
M7  接入现有 Session RAG Tool
        ↓
M8  Android 验收
        ↓
M9  iOS 验收
        ↓
M10  RAG 评测 + 性能压测
        ↓
M11 Native Vector Store（按基准决定）
        ↓
M12 端侧 Embedding（后续）
```

---

## 22. 当前正式决策

**D-001：** Android 与 iOS 统一走 Mobile Local RAG。  
**D-002：** 不以 NAS/服务器作为产品架构依赖。  
**D-003：** 复用 `SessionAttachmentRagController` 接口。  
**D-004：** 复用 Parent/Child Chunk 设计。  
**D-005：** MVP Recall Top 20 / Final Top 8。  
**D-006：** MVP 默认不启用 Rerank。  
**D-007：** MVP 允许用户 Embedding API；端侧 Embedding 后置。  
**D-008：** MVP 使用项目已有 Capacitor SQLite。  
**D-009：** MVP 先实现可替换的 SQLite BLOB 向量后端，再根据真实性能决定是否接入 Native Vector Extension。  
**D-010：** 18 MB KB 作为首个硬验收数据集。  
**D-011：** 上游 6 MB RAG 解析限制必须在移动端方案中解决。  
**D-012：** Desktop RAG 保持独立，不因为移动端魔改而重构其核心运行链路。

---

## 23. 参考源码与资料

### Chatbox

- https://github.com/chatboxai/chatbox
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/platform/mobile_platform.ts
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/platform/interfaces.ts
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/platform/session-attachment-rag/interface.ts
- https://github.com/chatboxai/chatbox/blob/main/src/main/session-attachment-rag/chunking.ts
- https://github.com/chatboxai/chatbox/blob/main/src/main/session-attachment-rag/file-loaders.ts
- https://github.com/chatboxai/chatbox/blob/main/src/main/session-attachment-rag/db.ts
- https://github.com/chatboxai/chatbox/blob/main/src/main/session-attachment-rag/ipc-handlers.ts
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/packages/model-calls/toolsets/session-attachment-rag.ts
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/stores/sessionHelpers.ts
- https://github.com/chatboxai/chatbox/blob/main/src/renderer/packages/model-calls/toolsets/file.ts
- https://github.com/chatboxai/chatbox/blob/main/package.json
- https://github.com/chatboxai/chatbox/blob/main/LICENSE

### Mobile SQLite

- https://github.com/capacitor-community/sqlite
- https://github.com/capacitor-community/sqlite/blob/master/docs/API.md

### Vector extension candidates for later benchmarking

- https://github.com/asg017/sqlite-vec
- https://github.com/sqliteai/sqlite-vector

---

## 24. 文档备注

这是项目的**技术基线与开工规格**，不是对上游未来版本的永久承诺。由于上游使用 `main` 持续开发，正式编码前必须先记录具体 commit SHA，并以该 SHA 作为本轮开发基线。

**当前项目状态：可以正式开工。**
