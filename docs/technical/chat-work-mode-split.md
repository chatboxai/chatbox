# 聊天/工作模式分化（Chat / Work Mode Split）

> Last updated: 2026-10

本文档记录聊天模式与工作模式在**消息结构操作自由度**上的分化设计：聊天模式放开结构自由（平铺追加回答、生成中切换分支、自由编辑删除），工作模式收紧结构手术（禁止平铺追加、删除分支等；助手消息可编辑但多 step 只改最后一段输出文本），同时保留单条消息删除、消息队列与 steering。涵盖动机、分阶段设计、性能与兼容性决策。

相关文档：[会话管理系统](./session-management.md)（fork 数据模型）、状态管理（生成锁与并发控制）。

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
| 编辑助手消息 | 允许 | 允许；多 step 消息只改最后一段输出文本，工具调用与中间步骤保持不变 |
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

静态能力限制收敛在 `packages/chatbox-core/src/session/mode-policy.ts`：`isActionAvailableInMode(action, mode)`，动作词表包括 `reply-below`、`edit-assistant-message`、`delete-message`、`delete-fork`、`save-message-edit`（仅保存不重发）、`session-system-prompt`（会话自带的系统提示词）、`queue-message`、`steer-queued-message`、`create-thread`（新话题）、`thread-history`（话题历史列表 / 抽屉 / 消息流标签）。工作模式助手消息编辑由 `shouldRestrictMessageEditToLastOutput` 收窄为只改最后一段可见输出文本。工作模式在对话已有可缓存前缀时，删除历史消息与切换模型的二次确认由 `packages/chatbox-core/src/session/prompt-cache-policy.ts` 判定。

与 `action-gates.ts` 的分工刻意区分两种语义：

- **action-gates**：临时锁（流式中 / compaction / 待审批），UI 表现为禁用 + toast 解释"为什么暂时不行"。
- **mode-policy**：静态能力（该模式下没有这个功能），UI 表现为**隐藏入口**，不解释、不禁用。

唯一需要同时看两者的动作是"生成中切换分支"：它是临时锁的模式化例外，因此实现为 `getSessionActionGate('switch-fork', locks, { sessionMode })` 的 context 参数——`sessionMode: 'chat'` 时不再被 generating 锁阻挡（compaction 锁不变），`'work'` 或未传时保持旧行为。Renderer 与 RN 都传入从会话 header 解析的模式；未传模式时采用保守锁策略。

策略执行采用与 `guardSessionAction` 相同的双层防御：UI 按策略隐藏入口；store 动作入口（如 `generateMore`）内做后备检查，拦下陈旧界面/新增调用面的漏网请求。**模式策略是客户端 UX 约束，不是数据不变量**——旧版本客户端与同步端不强制执行，任何数据层逻辑不得假设"工作模式会话的消息不可变"。

## 分阶段设计

### 阶段一：在下方回答回退平铺插入

`generateMore` 委托共享 `ChatMessageService.replyBelow`，通过 `message-insert-after` 行命令在指定消息后插入生成占位，再启动生成。要点：

- **不包 session 生成锁**，允许多条候选并发生成；准备阶段持有 runtime preparation lease，插入命令再次校验锚点和动作锁。
- 回复插入目标消息所属的选中路径，按稳定 message ID 持续写入；用户随后切换分支，不改变这条生成流的持久化目标。
- **单条停止按钮恢复**：主列表中生成中的消息在并发数 >1 时显示独立停止（复用 `shouldShowConcurrentReplyStop`，单条流式时维持"输入框停止"的无按钮设计）。
- picture 会话的"在下方生成更多图片"走同一入口，一并回退。
- 下一轮请求中连续多条 assistant 消息由 `sequenceMessages` 合并（平铺时代既有管线，未拆除）。

**接受的代价**：未删除的候选回答会进入后续轮次上下文（token 开销 + 插入点一次性 cache 失效）。这是目标用户群体主动管理的行为（对比后删除多余候选），且被限定在聊天模式内。

**存量数据**：候选分支与平铺回复都转换为 thread 内的消息行关系。ForkGroup 按独立分支选项页和正文页展示未选中的分支；历史格式的升级边界见[会话管理系统](./session-management.md)。

### 阶段二：模式策略与切换收口

- 新增 mode-policy 模块（见上节）。
- **模式切换冻结**：`setSessionAgentMode` 增加 `source` 参数；会话产生首条用户消息后，`'user'` 来源的跨模式切换（`'on'` ↔ 非 `'on'`）被拒绝。智能切换建议的 accept（`lockSessionAgentMode`）与 decline（`'auto'→'off'`，source `'suggestion'`）不受影响；`'auto'` ↔ `'off'` 属聊天模式内部偏好，本就由智能切换开关的过期逻辑（首条消息后禁用）覆盖。
- 模式面板两个方向对称锁定：工作→聊天沿用 `entry.locked`；聊天→工作在会话开始后禁用按钮，tooltip 复用既有文案（"Locked after the chat starts… start a new chat to change"）。
- 工作模式消息限制落在 UI 入口（隐藏）+ store 后备：助手消息可编辑，多 step 回复只改最后一段输出文本（工具调用与中间步骤文本保持不变）；用户消息编辑弹窗仅 Save & Resend（隐藏"仅保存"、锁定角色选择器）；在下方回答入口移除；ForkGroup 删除分支入口移除；单条消息删除与最新压缩摘要的编辑/删除保留。对话已有可缓存前缀（压缩摘要、工具历史，或可见正文达到 `PROMPT_CACHE_CONFIRM_MIN_CHARS`）时，删除历史消息与切换模型会弹出说明缓存失效的二次确认；判定看当前选中的 provider 上下文（压缩点、上下文条数、进行中请求的前缀），删掉不在该上下文里或删完上下文不变的消息不弹。不再提示按场景记在 `uiStore`（删除历史消息 / 切换模型 / 删除摘要），互不影响。新话题入口隐藏（store 侧 `refreshContextAndCreateNewThread` 做后备拦截并覆盖快捷键路径，模式经 `getSessionAgentModeEntry` 规范解析以兼容 legacy map 会话）；话题历史在会话没有归档话题时隐藏，已有归档话题时保留消息流分隔与历史入口，避免把多个话题误呈现成一段连续对话；上下文压缩归档不受影响。
- 存量已混用模式的会话不迁移，策略从更新后开始生效。

### 阶段三：聊天模式禁用消息队列与 Steering

- `getSubmitAction` / `getSubmitControl` 增加 `queueEnabled` 参数：聊天模式下生成中提交返回 `'block'`（弹既有 `'generating'` 锁提示），控件保持 Stop 不再切换为入队。
- 队列 UI（QueuedMessagesBar 的立即发送等）按模式隐藏新增入口；**存量已排队消息只出不进**——继续按序送达直到清空（队列不变量"用户文本永不丢"保持）。
- steering consumer 对聊天模式生成不注册。
- 该阶段同时消掉两个已知语义洞：排队消息在分支切换后投递到另一条分支的歧义；steering 锚点被切换挪进 fork list 触发 `MessageAnchorNotFoundError`（`message-insert-after` 命令的 `requireAnchor` 仍在提交前校验目标关系）。

### 阶段四：聊天模式生成中放开切换分支

`action-gates` 中 `switch-fork` 的 generating 锁按 `sessionMode` 分化（chat 放开，work / 未知保守维持）。`delete-fork` 与 compaction 锁在两个模式下均不变。

生成与列表窗口通过稳定身份协作：

- 流式缓冲和正文检查点按 message ID 更新；行命令只读取目标及所需局部关系，生成目标可以位于未选分支或历史 thread。
- `SessionService` 发布已提交的行 delta，`SessionQueryBridge` 将最终正文和关系元数据投影到已加载行与点查询。分支切换保留已加载公共前缀及其它生成消息的 live overlay。
- `readSessionGenerationControl` 结合 thread 控制投影、持久化生成状态及 runtime ID 集合提供精确锁信息；列表窗口之外的生成也参与判定。
- 全局停止先协调 runtime 与准备中的生成，再读取相关生成 ID 和少量目标正文，逐条完成终态行写入。读取冲突可以有界重试，已经提交的终态写入不能重放。
- 首窗读取后异步调用 `recoverInterruptedGenerations`，按持久化生成 ID 执行 `message-recover` 行命令；当前 runtime 正在运行的消息不会被恢复任务终止。

ForkGroup 的计数和当前分支来自消息行的轻量 fork 投影。展开时分页读取分支选项，再按需读取选定分支的有界正文；未选分支内的运行中消息通过精确的 runtime 归属和点查询展示，并保留单条停止入口。

### 阶段五：Save & Resend 消息版本化

编辑用户消息后重发采用**消息版本化**，两个模式共用（工作模式下它仍是用户消息的唯一编辑路径）：`ForkService.saveAndResend` 提交 `fork-save-resend` 行命令，把 **[原消息, ...旧尾巴]** 的既有行关系保留为**前驱消息**下的分支（pivot 跳过 summary，与 `regenerateInNewFork` 的既有约定一致），编辑后的内容以**新 id** 作为新活跃尾巴的开头再生成回复——每条时间线各自携带自己的 prompt，切回旧分支看到的仍是它当初回应的那句提问。分支关系与新正文在一次 revision/CAS 提交内完成，避免 prompt 在两次写之间闪断；fork 切换器因此落在前驱消息上（通常是上一条助手回复）。

有合法前驱时，pivot 使用该前驱：分支保留 pivot **之后**的路径，pivot 本身是各分支共享的主线。因此编辑后的 prompt 与旧 prompt 各自属于自己的分支。首条消息遵循下述共享 pivot 约定。

边界与回退（口径统一为**用户文本永不丢**）：

- 无合法前驱（会话首条消息，或前面只有 summary）：就地覆写 + 在被编辑消息自身建分支。
- guard 拦截、锁内行读取失败、fork 提交失败：仅就地保存编辑，不重发。编辑弹窗在交出内容后即关闭并 void-call 该动作，因此这条路径上的失败一律吞掉，不外抛未处理 rejection。
- fork 行事务成功、后置列表元数据投影失败时，按已提交处理并照常重发：分支此时已按原 id 持有原提问，就地保存反而会把归档的提问覆写成编辑后的文本。`createSaveAndResendFork` 因此只在**什么都没落盘**时才 reject。

**共享 RAG 附件所有权**：版本化让原消息与副本引用同一条 `session_attachment` 索引行，而该行按 `message_id` 单一归属。消息或分支删除提交后，`cleanupSessionAttachments` 通过 `collectSessionAttachmentOwnership` 读取所有 thread 和分支的归属 facts；完整扫描成功后，先 `rebindAttachment` 到幸存引用；单消息删除传入 `removedMessageId` 时，再删除该旧 owner 的附件记录。分支删除调用只重新绑定幸存引用，资源回收由后续清理处理。读取或重新绑定失败时保留资源，避免让幸存分支丢掉索引文件。

## 性能考量

聊天模式会话可达数十 MB 文本，并包含大量分支与 thread。数据读取和 UI 工作量按用途约束：

1. **生成锁与模式**：模式来自独立 header，锁来自控制投影与 runtime 身份。流式 chunk 不需要重新构造或遍历完整会话；界面通过共享控制查询消费结果。
2. **流式写入与停止**：检查点及终态写入只提交目标消息和必要派生信息。停止多条流会处理各自目标，成本与涉及的生成消息及关系操作有关，不按每条流重复序列化历史正文。
3. **模式策略**：`isActionAvailableInMode` 是纯函数；列表与输入区将解析后的模式传给动作控件。
4. **列表与分支**：Virtuoso 和 FlashList 只接收已加载的正文窗口。Electron/Web 每页100条，RN/Capacitor 每页20条。连续浏览保留已加载分页，明确跳转可替换窗口；分支切换保留公共前缀。分支选项与未选分支正文分别分页。
5. **上下文构建**：先在关系与消息 facts 上应用压缩边界、上下文条数等选择规则，再读取所需正文。平铺候选只有进入选定上下文时才增加请求内容；无限上下文是显式设置。
6. **Token 与导航**：历史 Token 任务在首窗可交互后独立分批执行；minimap 从正文窗口消息生成预览并共用分页。二者都按有界数据工作。

## 兼容性

- 模式策略是客户端 UX 约束。行命令仍须校验身份、关系和 revision，不能把“工作模式不允许某操作”当成持久化数据永远不变的保证。
- 历史 JSON 及旧行格式在升级或导入边界转换并验证；发布后以行数据为权威。消息、thread、分支和队列的业务路径使用独立行接口，完整 `Session` 只作为历史输入格式解析。版本保护、候选发布与失败恢复见[会话管理系统](./session-management.md)。
- Renderer 与 RN 共用 Chat/Fork 服务、模式策略和行命令，按各宿主能力提供操作入口。查看工作模式会话时仍遵循其模式限制。
- HarmonyOS 的 runtime shell 使用 web renderer，遵循同一模式策略和行存储接口。
