# Chatbox 移动端 RAG 项目补丁 v1.1

这是对前面《Mobile Vector RAG》实施文档的**增量补丁**，不是推翻重做。Agent 应在原方案基础上修改。

## 1. 架构升级：Mobile Hybrid Story RAG

不要实现成纯 Vector RAG。

最终链路：

```text
《蛊真人》约18MB KB
→ Chunk + Metadata
→ SQLite 本地存储
→ 当前剧情状态解析
→ 实体/关键词检索 + 时间线/状态过滤 + 向量检索
→ Candidate 20~50
→ Rerank
→ Top 5~10
→ LLM
```

SQLite 是存储层，不等于 RAG。SQLite 负责 KB、chunk、metadata、embedding、索引状态；RAG 负责检索、过滤、排序和上下文注入。

## 2. 为什么必须 Hybrid

《蛊真人》AI 剧情游戏不能只靠语义相似度。

必须重点防止：
- 时间线假推进
- NPC 莫名知道未来信息
- 捏造不存在的蛊虫
- 捏造不存在的流派
- 检索到未来事件并当成当前事实
- 人物当前不应该知道的信息被直接注入

因此最终相关性不能只看 vector similarity。

至少综合：
```text
实体匹配
+ 时间线有效性
+ 状态有效性
+ 关键词匹配
+ 向量相似度
+ Rerank
```

## 3. 移动端正式架构不得依赖 NAS

正式运行必须支持：

```text
Chatbox Android/iOS
→ 本地 SQLite
→ 本地 Hybrid Retrieval
→ 用户自己的 LLM
```

NAS最多作为开发测试环境，不能成为正式运行时依赖。

## 4. 尽量复用 Chatbox 现有架构

不要重新造一套完全独立的 KB 系统。

优先复用：
- Session Attachment RAG 接口
- Chunk / RAG 类型
- embedding 抽象
- attachment 生命周期
- Platform 抽象
- 现有 SQLite 能力

目标：

```text
Desktop → 现有 Desktop SessionAttachmentRagController
Mobile  → 新增 Mobile SessionAttachmentRagController
```

上层接口尽量保持一致，Desktop RAG 不得被破坏。

## 5. SQLite 的使用方式

移动端已有 Capacitor SQLite 能力，优先用于：

```text
attachments
parents
chunks
metadata
entities
timeline
keywords
embeddings
index_state
```

但不要假设“SQLite = 向量数据库”。

第一版优先实际测试：

```text
SQLite
+ 结构化/关键词检索
+ brute-force cosine vector search
```

当前 KB 约18MB，先测性能。如果已经足够快，不要为了理论性能提前引入复杂 ANN。

如果确实成为瓶颈，再评估 SQLite vector extension / 原生 ANN / WASM 等方案，并分别验证 Android/iOS 构建兼容性。

## 6. Timeline / State 必须成为一等公民

至少预留等价于以下信息的结构：

```text
timeline_id
event_time
event_order
valid_from
valid_to
```

并允许知识片段带有：
- 人物
- 地点
- 组织
- 蛊虫
- 流派
- 境界
- 事件
- 当前状态

关键规则：

> “与当前问题相关”不等于“当前时间点已经成立”。

## 7. 不得全量塞 Prompt

禁止：

```text
18MB KB → 全量 Prompt
```

也不要把 SQLite 查出来的大量文本全部发给模型。

目标：

```text
18MB
→ 多路召回
→ 20~50 candidates
→ rerank
→ 5~10 chunks
→ LLM
```

## 8. Embedding 必须抽象

不要把某一个 embedding 服务写死。

建议保留类似：

```ts
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}
```

未来至少能扩展：
- 本地 embedding
- 用户自己的 embedding API
- Chatbox 可用的 embedding 服务
- 预计算 embedding

如果固定《蛊真人》KB的版权和分发方式允许，可以考虑随 KB 分发预计算 embedding/index，减少首次索引成本。

不同 embedding 模型的向量空间不能直接混用。

## 9. 18MB KB 索引要求

当前工作 KB 按**约18MB**设计，不再按旧的77.5MB版本设计。

索引必须支持：
```text
pending
parsing
chunking
embedding
ready
failed
```

并记录至少：
```text
processed_count
total_count
last_error
embedding_model
embedding_dimension
updated_at
```

要求：
- 完整导入
- 可中断
- 可恢复
- embedding 失败可重试
- 单个失败不应导致整个 KB 作废
- App 重启后索引仍存在

## 10. Android / iOS 必须分别验收

不能 Android 成功就认为移动端完成。

两端都要实际验证：
- SQLite 创建
- 18MB KB 导入
- chunk 建立
- embedding
- 关键词检索
- 向量检索
- Hybrid 检索
- Rerank
- RAG 注入
- App 重启后数据保留
- 索引中断恢复

涉及 SQLite / WASM / native module 的依赖必须实际验证两端构建。

## 11. Desktop 不得回归

保持：

```text
Desktop → 原有 RAG
Mobile  → 新增 Mobile Hybrid RAG
```

尽量共享：
- 类型
- query plan
- retrieval result
- metadata
- rerank
- orchestration

平台相关部分再分别实现：
- SQLite driver
- 文件访问
- embedding runtime
- vector backend

## 12. 性能必须实测

至少记录：
- KB 导入时间
- 首次建索引时间
- embedding 时间
- SQLite 数据库大小
- 关键词检索耗时
- 向量检索耗时
- Hybrid 检索耗时
- Rerank 耗时
- 完整 RAG 耗时
- 内存峰值
- 重启恢复时间

至少关注 P50 / P95。

不要为了理论 ANN 性能增加不必要依赖。

## 13. 必须加入真实剧情回归测试

不能只测试“什么是蛊虫”这种普通问答。

至少测试：

### 时间线
当前剧情尚未发生的事件，不能作为当前事实注入。

### NPC 知识边界
KB中存在的信息，不代表某个NPC当前就知道。

### 虚构实体
查询不存在的蛊虫/流派，不能因为语义相似而创造一个“看起来合理”的实体。

### 人物状态
查询人物当前状态时，优先返回当前时间线有效信息。

### 事件
同一事件必须能够区分：
- 已发生
- 尚未发生
- 后续结果

### 模糊查询
用户不说专有名词时，仍应能通过向量检索找到正确知识。

## 14. 实施优先级

按原项目阶段调整为：

P0：确认并复用 Capacitor SQLite、Session Attachment RAG、Platform 抽象和 Desktop RAG 接口。

P1：移动端 SQLite + KB/chunk/metadata 持久化。

P2：Hybrid Retrieval：entity/keyword + timeline/state + vector。

P3：candidate retrieval → rerank → final context。

P4：接入现有 Session Attachment RAG。

P5：Android 真机验收。

P6：iOS 真机/模拟器验收。

P7：使用真实《蛊真人》剧情进行回归测试与性能 benchmark。

## 15. 最终验收标准

最终目标不是“手机能搜索18MB文档”，而是：

> Android/iOS 可以本地索引约18MB《蛊真人》KB，并通过 Hybrid Retrieval 给 AI 剧情提供时间线、实体、状态和语义均合理的上下文，同时不破坏 Desktop RAG。

最终链路：

```text
玩家输入
↓
当前剧情状态
↓
实体 / 时间 / 状态解析
↓
关键词 + 向量混合召回
↓
时间线/状态过滤
↓
Rerank
↓
5~10条高相关知识
↓
LLM
↓
剧情推进
```

### 三条硬约束

1. **不依赖用户 NAS。**
2. **不把纯 Vector RAG 当最终方案。**
3. **不能为了移动端 RAG 破坏现有 Desktop RAG。**

## 16. 给 Agent 的执行要求

把本补丁视为原任务的架构修正，不要重新从零设计。

实现时：
- 优先复用现有代码
- 小步修改
- 每阶段运行测试
- 不删除 Desktop RAG
- 不把18MB KB全量注入 Prompt
- 不引入未经 Android/iOS 验证的重量级依赖
- 不把 NAS 作为正式运行时依赖
- 对关键性能数据进行 benchmark
- 架构冲突时，以“现有 Chatbox 架构 + 移动端可维护性 + 剧情 RAG 正确性”为判断依据

**最终验收以真实 Android/iOS + 18MB《蛊真人》KB + 真实剧情回归测试为准，而不是仅以编译通过为准。**
