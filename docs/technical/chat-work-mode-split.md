# 聊天/工作模式分化（Chat / Work Mode Split）

> Last updated: 2026-09

本文档记录聊天模式与工作模式在**消息结构操作自由度**上的分化设计：聊天模式放开结构自由（平铺追加回答、生成中切换分支、自由编辑删除），工作模式收紧结构手术（禁止平铺追加、编辑助手消息、删除分支等），同时保留单条消息删除、消息队列与 steering。涵盖动机、分阶段设计、性能与兼容性决策。

相关文档：[会话管理系统](./session-management.md)（fork 数据模型）、[状态管理](./state-management.md)（生成锁与并发控制）。

---

## 背景与动机

「在下方回答」（Reply Again Below）最初的行为是**在消息序列中平铺插入**一条新回复。PR 948 将其改为创建 inactive fork 分支（折叠卡片展示），动机是保护后续轮次的 prompt cache 前缀、并让活跃路径保持"一问一答"的干净不变量。

上线后收到明确的用户反馈（主要来自文游 / 角色扮演 / 小说创作群体）：

1. **对比多个回答**的工作流被打断——平铺时代所有候选回答同时可见；分支化后需要展开卡片，且卡片只读。
2. **删除原回答实现"替换"**的习惯不可用——平铺时代直接删掉不要的回答即可；分支化后要先切换再删分支，多步且难发现。
3. **生成中无法切换分支**——等待一条新回答生成时，无法翻看其他已完成的回答（生成锁把 switch-fork 一并挡住）。

重新评估后的结论：prompt cache 与上下文卫生的收益**只在工作模式下真正重要**（agent 上下文大、工具历史重、cache 经济性敏感）；聊天模式本来就允许随意编辑删除消息，从来不是 cache 稳定场景，结构自由是该用户群体的核心诉求。因此不做全局折中，而是**按模式分化**。

## 模式分化总表

| 维度 | 聊天模式（Chat Mode） | 工作模式（Work Mode） |
|------|----------------------|----------------------|
| 在下方回答 | 平铺插入活跃路径，可多条并发生成 | 入口移除 |
| 重新生成（Reply Again） | 创建 fork 分支（维持现状） | 创建 fork 分支（维持现状） |
| 生成中切换分支 | 放开 | 维持禁止 |
| 删除分支（delete-fork） | 允许（生成中仍禁止） | 入口移除 |
| 编辑助手消息 | 允许 | 禁止 |
| 删除消息 | 允许 | 允许；对话已有可缓存前缀时，删除历史消息需二次确认（可按场景勾选不再提示） |
| 编辑压缩摘要 | 允许 | 允许 |
| 编辑用户消息 | 允许（可只存不发） | 仅 Save & Resend，无"仅保存"，禁改角色 |
| 会话系统提示词 | 消息列表展示，会话设置可编辑（受"隐藏系统提示词"开关控制） | 两处入口都隐藏（身份由 Soul 表达；Copilot 人设冻进 Soul 段，无 Copilot 的会话 prompt 不进入请求） |
| 新话题 / 话题历史 | 允许 | 不允许创建新话题；无历史时隐藏话题历史，已有归档话题时保留分隔与历史入口 |
| 切换模型 | 允许 | 对话已有可缓存前缀时需二次确认（可勾选不再提示） |
| 消息队列（message queue） | **禁用**（生成中阻断发送） | 保留 |
| Steering（立即发送插队） | **禁用** | 保留 |
| 全局停止 | 停止一切可达的生成（含 fork 分支内） | 同左（现状） |
| 模式切换 | 仅新对话可选；会话中仅智能切换可升级 | 首条消息后锁死（已有 `AgentModeEntry.locked`） |

设计原则：**每个模式内部自洽，跨机制的交叉项由模式边界消掉**。队列×分支投递歧义、steering 锚点×分支切换、审批流×fork 移动、沙箱副作用×并行分支——这些难缠的交互全部只存在于"队列/steering/审批/沙箱"与"结构手术"同时开启的世界；分化后两组能力不再共存于同一个模式。

## 模式的定义与解析

会话模式由 `session.settings.agentMode.value` 决定：`'on'` 为工作模式，`'off'` / `'auto'` / 未设置为聊天模式（`'auto'` 只控制首轮智能切换分类器，能力上等同聊天模式，见 `agentModeState.ts`）。

策略解析使用 `@chatbox/core` 的 `resolveSessionMode()`（纯函数），renderer 侧响应式场景经 `useSessionAgentMode` 取 entry 后映射。**模式策略跟随会话数据而非平台能力**：移动端查看桌面创建的工作模式会话时，虽然 agent 不能运行，消息限制仍然生效，保证跨设备行为一致。

## 模式策略模块（mode-policy）

静态能力限制收敛在 `packages/chatbox-core/src/session/mode-policy.ts`：`isActionAvailableInMode(action, mode)`，动作词表包括 `reply-below`、`edit-assistant-message`、`delete-message`、`delete-fork`、`save-message-edit`（仅保存不重发）、`session-system-prompt`（会话自带的系统提示词）、`queue-message`、`steer-queued-message`、`create-thread`（新话题）、`thread-history`（话题历史列表 / 抽屉 / 消息流标签）。工作模式在对话已有可缓存前缀时，删除历史消息与切换模型的二次确认由 `packages/chatbox-core/src/session/prompt-cache-policy.ts` 判定。

与 `action-gates.ts` 的分工刻意区分两种语义：

- **action-gates**：临时锁（流式中 / compaction / 待审批），UI 表现为禁用 + toast 解释"为什么暂时不行"。
- **mode-policy**：静态能力（该模式下没有这个功能），UI 表现为**隐藏入口**，不解释、不禁用。

唯一需要同时看两者的动作是"生成中切换分支"：它是临时锁的模式化例外，因此实现为 `getSessionActionGate('switch-fork', locks, { sessionMode })` 的 context 参数——`sessionMode: 'chat'` 时不再被 generating 锁阻挡（compaction 锁不变），`'work'` 或未传时保持旧行为。未传参保守化的目的是让尚未适配的宿主（mobile-native）自动维持旧语义。

策略执行采用与 `guardSessionAction` 相同的双层防御：UI 按策略隐藏入口；store 动作入口（如 `generateMore`）内做后备检查，拦下陈旧界面/新增调用面的漏网请求。**模式策略是客户端 UX 约束，不是数据不变量**——旧版本客户端与同步端不强制执行，任何数据层逻辑不得假设"工作模式会话的消息不可变"。

## 分阶段设计

### 阶段一：在下方回答回退平铺插入

`generateMore` 从"创建 inactive fork + 隔离上下文生成"回退为 `insertMessageAfter` + 直接生成（即原 fallback 路径转正）。要点：

- **不包 session 生成锁**，保持多条候选并发生成的能力（与旧行为一致；入口内部由 orchestrate 统一等待 unsettled stream drains）。
- 回退后**所有生成流都回到活跃路径**（root 或 thread 尾部），"流式写入非活跃容器"不再是常规流程（仅在阶段四的生成中切换后出现）。
- **单条停止按钮恢复**：主列表中生成中的消息在并发数 >1 时显示独立停止（复用 `shouldShowConcurrentReplyStop`，单条流式时维持"输入框停止"的无按钮设计）。
- picture 会话的"在下方生成更多图片"走同一入口，一并回退。
- 下一轮请求中连续多条 assistant 消息由 `sequenceMessages` 合并（平铺时代既有管线，未拆除）。

**接受的代价**：未删除的候选回答会进入后续轮次上下文（token 开销 + 插入点一次性 cache 失效）。这是目标用户群体主动管理的行为（对比后删除多余候选），且被限定在聊天模式内。

**存量数据**：fork 时代产生的候选分支继续由 ForkGroup 渲染，无迁移。shared 的 `buildCreateInactiveForkPatch` 保留（mobile-native 仍在引用，等 native 同步回退后再删）。

### 阶段二：模式策略与切换收口

- 新增 mode-policy 模块（见上节）。
- **模式切换冻结**：`setSessionAgentMode` 增加 `source` 参数；会话产生首条用户消息后，`'user'` 来源的跨模式切换（`'on'` ↔ 非 `'on'`）被拒绝。智能切换建议的 accept（`lockSessionAgentMode`）与 decline（`'auto'→'off'`，source `'suggestion'`）不受影响；`'auto'` ↔ `'off'` 属聊天模式内部偏好，本就由智能切换开关的过期逻辑（首条消息后禁用）覆盖。
- 模式面板两个方向对称锁定：工作→聊天沿用 `entry.locked`；聊天→工作在会话开始后禁用按钮，tooltip 复用既有文案（"Locked after the chat starts… start a new chat to change"）。
- 工作模式消息限制落在 UI 入口（隐藏）+ store 后备：编辑入口仅用户消息保留，编辑弹窗仅 Save & Resend（隐藏"仅保存"、锁定角色选择器）；在下方回答入口移除；ForkGroup 删除分支入口移除；单条消息删除与最新压缩摘要的编辑/删除保留。对话已有可缓存前缀（压缩摘要、工具历史，或可见正文达到 `PROMPT_CACHE_CONFIRM_MIN_CHARS`）时，删除历史消息与切换模型会弹出说明缓存失效的二次确认；判定看当前选中的 provider 上下文（压缩点、上下文条数、进行中请求的前缀），删掉不在该上下文里或删完上下文不变的消息不弹。不再提示按场景记在 `uiStore`（删除历史消息 / 切换模型 / 删除摘要），互不影响。新话题入口隐藏（store 侧 `refreshContextAndCreateNewThread` 做后备拦截并覆盖快捷键路径，模式经 `getSessionAgentModeEntry` 规范解析以兼容 legacy map 会话）；话题历史在会话没有归档话题时隐藏，已有归档话题时保留消息流分隔与历史入口，避免把多个话题误呈现成一段连续对话；上下文压缩归档不受影响。
- 存量已混用模式的会话不迁移，策略从更新后开始生效。

### 阶段三：聊天模式禁用消息队列与 Steering

- `getSubmitAction` / `getSubmitControl` 增加 `queueEnabled` 参数：聊天模式下生成中提交返回 `'block'`（弹既有 `'generating'` 锁提示），控件保持 Stop 不再切换为入队。
- 队列 UI（QueuedMessagesBar 的立即发送等）按模式隐藏新增入口；**存量已排队消息只出不进**——继续按序送达直到清空（队列不变量"用户文本永不丢"保持）。
- steering consumer 对聊天模式生成不注册。
- 该阶段同时消掉两个已知语义洞：排队消息在分支切换后投递到另一条分支的歧义；steering 锚点被切换挪进 fork list 触发 `MessageAnchorNotFoundError`（`applyMessageInsert` 的 `requireAnchor` 退化为纯防御断言）。

### 阶段四：聊天模式生成中放开切换分支

`action-gates` 中 `switch-fork` 的 generating 锁按 `sessionMode` 分化（chat 放开，work / 未知保守维持）。`delete-fork` 与 compaction 锁在两个模式下均不变。

数据层无需改动，依据是既有机制已经容器无关：

- 流式 chunk 缓存更新与 2s/终态落盘均经 `applyMessageUpdate` 按 id 寻址（root → threads → fork lists 全搜）。
- 每次 fork 写入携带 `preserveCachedGeneratingMessages`，`mergeCachedGeneratingMessages` 两侧扫描全部三种容器。
- 生成锁由可达遍历推导（`getGenerationControlMessages`），流式消息被切进分支后 session 仍保持 generating 锁——不会误解锁导致跨分支并发新生成。
- 全局停止（`stopAllMessageGenerations`）= runtime 表全停 + 可达图扫尾（占位窗口墓碑），天然覆盖被切走的后台流。
- 崩溃残留的 `generating:true` 由 `recoverSessionOnLoad` 在加载时对全部容器修复。

UI 补丁：ForkGroup 对包含生成中消息的非活跃分支强制 reveal（切换保存回 slot 时 list id 不变，原有"新 id 才展开"的逻辑覆盖不到）。分支卡片除首条回复外还渲染 follow-up 尾部的流式候选（先平铺多条候选、再切走更早的分支时，live 流在 `firstReply` 之后）——否则卡片看起来已完成且没有单条停止入口；候选完成后保持可见（与分支级 sticky reveal 一致），折叠或切换分支时回到仅计数摘要，follow-up 计数只统计未展示的消息。

### 阶段五：Save & Resend 消息版本化

编辑用户消息后重发采用**消息版本化**，两个模式共用（工作模式下它还是唯一的编辑路径）：`buildSaveAndResendForkPatch`（shared）把 **[原消息, ...旧尾巴]** 整段存为**前驱消息**下的分支（pivot 跳过 summary，与 `regenerateInNewFork` 的既有约定一致），编辑后的内容以**新 id** 作为新活跃尾巴的开头再生成回复——每条时间线各自携带自己的 prompt，切回旧分支看到的仍是它当初回应的那句提问。fork + 替换在一次 session 写内完成，避免 prompt 在两次写之间闪断；fork 切换器因此落在前驱消息上（通常是上一条助手回复）。

pivot 必须是前驱而非被编辑消息自身，这是数据模型强制的：分支只保存 pivot **之后**的尾巴，pivot 本身是各分支共享的主线，以被编辑消息为 pivot 会让改写后的 prompt 成为所有分支的共同前缀。同类产品的选型一致——pi 的会话树、ChatGPT / Open WebUI / LibreChat 的消息版本化、Claude Code / Codex CLI 的 rewind、deepseek-harness 的纯 append-only，没有一家把 prompt 覆写与"旧回复留作可切分支"并存。

边界与回退（口径统一为**用户文本永不丢**）：

- 无合法前驱（会话首条消息，或前面只有 summary）：就地覆写 + 在被编辑消息自身建分支。
- guard 拦截、锁内 session 读失败、fork 写失败：仅就地保存编辑，不重发。编辑弹窗在交出内容后即关闭并 void-call 该动作，因此这条路径上的失败一律吞掉，不外抛未处理 rejection。
- fork 写入的"部分成功"（session 数据已落盘、仅列表元数据投影失败）按成功处理并照常重发：分支此时已按原 id 持有原提问，就地保存反而会把归档的提问覆写成编辑后的文本。`createSaveAndResendFork` 因此只在**什么都没落盘**时才 reject。

**共享 RAG 附件所有权**：版本化让原消息与副本引用同一条 `session_attachment` 索引行，而该行按 `message_id` 单一归属。删消息 / 删分支时先按 `planAttachmentOwnershipTransfers` 把幸存者仍引用的行 `rebindAttachment` 过去，再执行按 owner 的删除；孤儿维护则以"是否仍被活跃消息引用"而非"owner 是否可达"判定（`planOrphanCleanup`），被引用的行改为修复归属而不是删除。因此转移失败只影响时效，不会让幸存分支丢掉索引文件。

## 性能考量

聊天模式重度用户的会话可达**数十 MB 文本、大量分支与 threads**，以下是各改动的性能账：

1. **锁推导（每 chunk 重跑）**：`useSessionLockState` 在每个流式 chunk 后对新 session 快照重新推导。可达遍历为 O(全部消息数) 的 Set 操作，已由 PR 1011 的两项机制兜底——per-snapshot WeakMap 缓存（一个渲染周期所有消费者共享一次遍历）与 `sessionLockStatesEqual` 引用稳定（值不变时 memo 组件零重渲）。本设计**没有改变推导逻辑**（遍历本来就含 fork 分支），边际成本为零。
2. **禁止新增 per-row 订阅**：`sessionMode` 在 MessageList / InputBox 层解析一次后以 prop 下发（字符串，引用稳定）。数千行消息的会话里，任何加在 Message 行内的 store 订阅都会在每个 chunk 触发全行选择器求值，明确禁止。
3. **模式策略为纯函数**：`isActionAvailableInMode` 无状态无分配，可在渲染路径任意调用。
4. **全局停止的写放大**：停止 N 条并发流产生 N 次串行全量 session 落盘（coordinator RMW）。大会话单次写 10-50ms，N≤5 时总计 <250ms 异步 I/O，为既有行为非本次引入；若未来 profile 命中，收敛方向是把 N 个终态合并为一次 `updateSessionWithMessages` 批量写。
5. **平铺候选的渲染**：主列表为 Virtuoso 虚拟化，行数增加不改变可见窗口渲染成本；ForkGroup 卡片路径反而减少。
6. **上下文构建**：候选进入后续轮次会提高 token 估算与 context-pressure 输入规模，属既有 O(消息数) 管线的自然增长，无新增热点。

## 兼容性

- **数据零迁移**：Session 结构（`messageForksHash` / threads / queue 持久化）不变；新旧两种候选形态（fork 分支 / 平铺）长期共存渲染。
- **同步与旧客户端**：模式策略不写入数据层，旧客户端对工作模式会话仍可编辑删除——接受（策略是 UX 约束）。
- **mobile-native**：shared 的 fork patch 函数与 core 的 `contextMessages` 生成选项保留不删；`SessionActionContext.sessionMode` 未传时 switch-fork 维持旧锁语义，native 未适配前行为不变。native 需跟进的两项：在下方回答回退、mode-policy 接入（跟踪于 native 复用审计）。
- **HarmonyOS**：runtime shell 包裹 web renderer，随 renderer 生效。
