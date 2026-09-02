# Chat 模式代码执行技术设计

> Last updated: 2026-08

本文档描述 Chat 模式下代码执行、Agent Mode、工具暂停审批和 HTML 产物预览的技术设计。产品说明见 [`docs/product/code-execution.md`](../product/code-execution.md)。

---

## 系统概览

Chat 代码执行复用 Main 进程的本地沙箱基础设施，但在 Renderer 侧使用独立的高层工具集和 Agent Mode 编排。

```
Renderer
  orchestrateGeneration()
    ├─ shouldSuggestAgentMode()                   # 仅首轮 auto，快速分类模型
    │   └─ 命中 → 注入 agent-mode-suggestion 卡片并停止生成
    └─ prepareAgentGenerationHarness()
        ├─ computeEffectiveAgentMode(agentModeValue, supported)
        ├─ createSandboxProvider()                # desktop only
        ├─ buildToolsForSession()
        │   ├─ web_search / parse_link            # independent of agent mode
        │   ├─ code_execution / read_file / create_download
        │   ├─ filesystem tools: list/search/write/edit
        │   ├─ load_skill / install_skill / user_exec
        │   └─ MCP / knowledge base tools
        └─ chatStream(..., { tools })

Main
  src/main/sandbox/
    ├─ manager.ts                                 # sandbox session, exec, file IO
    ├─ ipc-handlers.ts                            # renderer bridge
    ├─ node-runtime.ts                            # bundled/resolved Node runtime
    ├─ preview-server.ts                          # local HTML preview
    └─ truncate.ts                                # output trimming
```

## Sandbox 工具说明

Chat 模式向模型注入的是 `code_execution` / `read_file` / `create_download` 等高层工具，工作目录为自动创建的临时沙箱目录，上传文件在首次工具调用时复制进沙箱。编排层先把 Auto 解析为有效的 On/Off，builder 只根据有效模式构建工具。

Chat 模式不再向模型注入底层 `sandbox_*` 工具，旧的 `toolsets/sandbox.ts` 已移除；历史消息仍由通用 tool-call UI 按工具名渲染。

## Code Execution 工具集

文件：`src/renderer/packages/model-calls/toolsets/code-execution.ts`

| 工具 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `code_execution` | `code`, `language`, `timeout?` | `{ stdout, stderr, exitCode }` | 执行短 Node.js、PowerShell（Windows）或 Bash 脚本。`language` 为 `node | powershell | bash` |
| `read_file` | `file_path`, `offset?`, `limit?` | `{ content, startLine, endLine, totalLines, hint? }` | 读取沙箱文件或经授权读取用户真实文件，按行数和输出字节数双重限制分页 |
| `create_download` | `file_path`, `display_name?` | `{ downloadable, file_path, display_name }` | 将沙箱文件标记为消息产物 |

### 运行环境

当前实现刻意移除了 Python 工具链：

- 不创建 venv，不预装 pandas/numpy/matplotlib，也不支持 pip 安装作为默认路径。
- Node.js 优先使用应用解析出的本地运行时，避免依赖用户 shell 的 `PATH` 或 nvm 初始化状态。
- Windows 优先使用 PowerShell 7，并回退到 Windows PowerShell；Bash 仅作为 Git Bash/WSL 可用时的可选运行时。
- macOS/Linux 可使用 Bash 执行轻量命令；核心文件工具不依赖 Bash 或 WSL。
- 图表优先生成 HTML/SVG/浏览器 JS，通过本地预览展示。

这个选择降低了安装包体积和签名风险，也让 Chat 代码执行聚焦于简单文件处理。

在 SRT 平台（macOS/Linux）上，沙箱子进程保留用户真实的 `HOME`（对齐 Codex / Claude Code 的做法）：隔离从不依赖 HOME 改写——SRT 的 deny 规则用主进程的 `os.homedir()` 展开，读默认放行（减去 `TASK_SANDBOX_DENY_READ_PATHS` 凭据路径），写在 allowWrite 之外一律拒绝。没有 OS 沙箱的平台（原生 Windows、HarmonyOS）则继续把 `HOME`/temp 改写到会话目录：那里没有任何机制拒绝对真实用户目录的写入，改写是唯一把 `~`、`os.homedir()`、临时文件引导进会话目录的手段。Windows 上额外注入 `GIT_CONFIG_GLOBAL` 指回真实全局 git 配置（`%USERPROFILE%\.gitconfig`，缺失时回退 XDG 路径，均不存在则不注入）——Git for Windows 从 `HOME` 解析全局配置，改写会让它丢失用户身份，这个定向注入只修 git、不影响其余工具链的 HOME 引导；`git config --global` 的写目标随之变为真实文件，无沙箱的原生执行本就能做到，不新增暴露面。真实 HOME 让 git 身份、行尾、镜像等所有 `$HOME` 配置自然生效，也消除了「仓库根部 `.gitconfig` / `.ssh/config` 被当作全局配置加载」的投毒面。npm 缓存通过 `npm_config_cache` 重定向到会话 `.cache/npm`（`~/.npm` 不可写）。用户授权目录顶层的 `.git/config` 与 `.git/hooks` 为只读（参照 Codex 的受保护 workspace 元数据，但仅限宿主逃逸向量）：它们会被用户下一次沙箱外的 git 调用执行，而 objects/refs/index 保持可写，commit / branch / rebase / 嵌套 clone 不受影响。

### 懒初始化和文件注入

沙箱在第一次工具调用时创建。初始化过程会把对话中的上传文件复制到会话沙箱：

- 文本文件按原文件名复制。
- 非文本文件如果已有上传阶段解析结果，会同时复制 `{filename}_parsed.txt`。
- 复制采用并发批次控制，避免大量文件 IPC 传输阻塞 UI。

工具结果必须保持小体积。大输出写入沙箱文件，再通过 `read_file` 分页、`create_download` 下载或 HTML 预览展示。

### 结构化文件操作

- `read_file` 和单目录 `list_files` 通过 `SandboxProvider` 调用受限 Node helper，不拼接 Bash 命令。Node helper 在 macOS/Linux 继续继承 SRT 隔离，在 Windows 使用原生工作目录。
- `read_file` 的 helper 输出单个 JSON 对象，并按 JSON 编码后的字节数限制内容，保证不会被通用 `execCode` 的 50KB stdout 截断逻辑破坏；内容达到上限时通过 `endLine` 继续分页。
- 递归文件发现和内容搜索使用应用内置 ripgrep，统一结果数量、超时、重目录排除和 Rust regex 语义；不使用 Node 递归遍历。
- 本地 `create_download` 直接调用 `persistArtifact`。相对路径基于会话工作目录解析，持久化前进行真实路径和允许根目录校验，不再通过 Shell 执行 `test` / `realpath`。

## Agent Mode

### 状态模型

```typescript
type AgentModeValue = 'auto' | 'on' | 'off'

interface AgentModeEntry {
  value: AgentModeValue
  locked: boolean
  lockReason: 'file_upload' | 'load_skill' | 'message_sent' | null
}
```

`agent` scope 是代码执行、文件工具、MCP、知识库和 Skills 的统一门控。Web Search 使用独立的 `web-browsing` scope，不受 Agent Mode 影响。

### 有效模式计算

`src/renderer/stores/session/agent-harness.ts` 中的 `computeEffectiveAgentMode(agentModeValue, agentModeSupported)`：

```typescript
export function computeEffectiveAgentMode(agentModeValue, agentModeSupported) {
  if (!agentModeSupported || agentModeValue === 'off') return 'off'
  return agentModeValue === 'on' ? 'on' : 'off'
}
```

规则：

- 非桌面端、模型不支持 agent scope，或用户选择 `off`：`effectiveAgentMode = 'off'`。
- 用户选择 `on`：`effectiveAgentMode = 'on'`，注入完整 agent 工具集。
- `auto`：`effectiveAgentMode = 'off'`。Auto **不再**根据文件类型或数量自动升级；是否进入 Agent Mode 由首轮的建议分类器决定（见下）。

### Auto 建议机制（首轮分类器）

文件触发已被移除，改为在会话首轮用一个独立的快速分类模型判断意图。逻辑位于 `packages/chatbox-core/src/generation/` 的 `shouldSuggestAgentMode()`（GenerationService）与 `agent-mode-suggestion.ts`。

触发条件（全部满足才运行分类器）：

- `operationType === 'send_message'` 且非 `appendToMessage`、非 `skipAgentModeSuggestion`。
- 桌面端、模型支持 `agent` scope（`agentModeSupported`），且 `agentModeValue === 'auto'`。
- 当前是该 thread 的首条用户消息（`isFirstUserTurn()`）。

流程：

1. 分类模型优先取全局设置的 `threadNamingModel`（廉价快速），无法创建时回退到对话模型。
2. 用 `AGENT_MODE_SUGGESTION_PROMPT` 让模型判断该消息是否需要代码执行、文件操作、本地工具、知识库、加载 Skill 等 Agent 能力，返回 `{"suggest":boolean,"reason":string}`。
3. **suggest=true**：在消息中注入一个 `agent-mode-suggestion` content part（携带 `reason`，与用户消息同语言），`finishReason: 'agent-mode-suggested'`，**停止本轮生成**。用户点击卡片上的“使用 Agent Mode”才将会话切为 On 并继续；点击“继续普通回答”则按普通文本对话处理。
4. **suggest=false**：静默跳过，按 `effectiveAgentMode = 'off'` 走普通文本生成，不注入 Agent 工具。
5. 分类期间用户取消时，消息被标记为 stopped，不会落入已 abort 的生成流程。

### 锁定机制

| 触发 | 场景 | 效果 |
|------|------|------|
| `message_sent` | 用户在 On 模式发送消息 | 锁定为 On |
| `load_skill` | 模型加载 Skill | 锁定为 On |

`AgentModeLockReason` 类型仍保留 `'file_upload'` 取值以兼容历史会话数据，但当前代码不再因文件上传触发该锁定。

### Auto 与工具构建边界

由于 `auto` 的 `effectiveAgentMode` 为 `'off'`，普通 Auto 对话不注入任何 Agent 工具；用户接受建议后会话变为 `on`，此时注入完整工具集。`buildToolsForSession()` 的输入只允许有效的 `on` / `off`，不包含 Auto，也没有 `initialActiveTools` / `prepareStep` 渐进门控。

## Tool 构建

文件：`src/renderer/stores/session/tools-builder.ts`

构建顺序：

1. Web Search：独立于 Agent Mode，只受用户开关和 `web-browsing` scope 控制。
2. 普通文件工具：当没有 code execution provider 且模型支持 `read-file` 时，用于读取内联附件/链接。
3. Session attachment RAG：对已有 session attachment 提供检索式读取。
4. Agent 工具：有效模式为 `on` 且模型支持 `agent` scope 时注入。
5. Code execution：存在 `codeExecution` provider 时注入 `code_execution/read_file/create_download`。
6. Filesystem tools：注入真实文件系统读写编辑工具；沙箱和绑定目录直接写入，其他路径按审批和 Full Access 设置处理。
7. 工作目录约束：绑定用户工作目录时，每轮构建上下文都会通过 Main 进程专用接口读取并注入 workspace 根目录的 `AGENTS.md`。读取前校验真实目录边界，拒绝符号链接文件和不安全根目录；所有 workspace 共用 80,000 字符预算。进入子目录时提示模型检查并遵循作用域更具体的 `AGENTS.md`。
8. Skills 与命令：注入启用 Skill 元数据、`load_skill`、`chatbox_cli`、On 模式可直接使用的 `user_exec`，以及 code execution 可用时的 `install_skill`。
9. MCP 和知识库：按会话配置和模型 scope 注入。

Chat Agent 不再 fallback 注入底层 `sandbox_*` 工具。

## 暂停、审批和继续

工具调用可能在三类情况下进入 `paused` 状态：

| pauseReason | 触发 | 继续行为 |
|-------------|------|----------|
| `tool_call_limit` | 多轮工具调用达到上限，且未解析为无人值守（见「多轮工具调用上限」） | 用户确认后执行原本暂停的工具调用 |
| `user_exec_approval` | `user_exec` 命令未命中白名单、未通过 AI 安全评估且未开启 Full Access | 批准后执行命令，拒绝后写入拒绝结果 |
| `command_escalation_approval` | `run_command` 在沙箱真实失败后，携带该结果明确返回的一次性 `retry_of` 请求主机重试 | 校验命令、目录和 shell 完全一致，批准后消费 reference 并执行一次 |
| `file_mutation_approval` | 写入或编辑绑定目录之外的用户真实文件系统，且未开启 Full Access | 批准后执行文件变更，拒绝后写入拒绝结果 |

设计要点：

- 暂停状态写入 `MessageToolCallPart.state = 'paused'`，随 session 持久化。
- 重启后 UI 可从消息状态恢复“继续/停止”操作，不依赖内存 Promise。
- 点击继续后走 `continuePausedToolCall()`，执行原工具并调用 `orchestrateGeneration(..., appendToMessage: true)`，结果追加到同一条 assistant 消息。
- 暂停的 tool call 不会作为已完成工具结果注入模型上下文，避免模型误判工具已经执行。
- `run_command` 的 `retry_of` 是 Main 进程为非零退出签发的 opaque reference，不是 tool call ID；它只在失败结果中明确返回，不能推断、跨命令复用或重复消费。Bash 执行启用 `pipefail`，避免 `git push | tail` 等管道把上游失败伪装成成功。
- `user_exec` 先检查安全只读白名单，再对本地策略允许评估的命令执行 AI 结构化安全判断；未通过或评估失败时进入持久化暂停。Full Access 跳过逐次审批，但仍记录审批来源。

## 多轮工具调用上限

GenerationService（`packages/chatbox-core/src/generation/`）通过 `withToolCallLimitPause()` 在达到上限时暂停，而不是返回一个普通 tool result 让模型继续循环。暂停发生在即将执行下一次工具前；用户点击继续后会执行该工具调用，并在同一条消息内继续生成。

当前常量位于 `MAX_TOOL_CALLS_BEFORE_CONFIRMATION`（`src/shared/utils/tool-call-limit-pause.ts`）。发布前应确认它符合产品目标值，避免测试用小阈值影响真实用户。

用户可以关闭这一确认暂停（针对长期挂机任务）：

- 设置项为 `pauseOnToolCallLimit`，会话级（`SessionSettingsSchema`，三态：`undefined` 跟随全局）与全局级（`SettingsSchema`，默认 `true`）各有一份。`shouldPauseOnToolCallLimit()` 的解析顺序为：
  1. 会话级设置存在时直接生效 —— 单个会话的显式选择优先级最高，保证对话设置里的开关不会显示与实际行为不符的状态。
  2. 会话解析为 Full Access（`resolveCommandApprovalMode()`，含 legacy `agentFullAccess`）时不暂停。Full Access 本身已跳过逐次审批、语义是无人值守，而全局设置默认为 `true`（始终有值），因此这里覆盖的是**全局默认值**而不是会话自己的选择。
  3. 否则取全局设置，默认暂停。
- 注意 `commandApprovalMode` 是会话级持久设置，与 agent mode 开关相互独立：曾开过 Full Access 的会话即使后来关掉 agent mode，默认仍不暂停。此时对话设置里的开关会显示为关闭状态，用户可显式打开重新拿回检查点。
- 暂停卡片上的 "Don't ask again" 菜单（`PausedToolCallDetails`）可选择仅当前会话或所有会话生效，写入设置后通过 `disableToolCallLimitPauseAndContinue()` 立即恢复当前暂停的批次。
- 会话级开关在对话设置（`SessionSettings.tsx`）中可重新打开；全局开关在设置 → 聊天设置（`routes/settings/chat.tsx`）中。

## HTML 产物预览

HTML 下载产物在桌面端可复用本地预览组件展示：

- Main 进程启动本地 preview server。
- 预览 URL 使用 `http://127.0.0.1:{port}/sandbox/{relativePath}`。
- `relativePath` 是会话沙箱内相对路径，不是系统绝对路径。
- 请求会解析到当前 tool call 产物所属的沙箱会话，允许 HTML 通过相对路径加载同一沙箱中的 JS/CSS/图片资源。

由于访问范围限定在当前沙箱产物上下文内，桌面本地预览不额外使用随机 token。

## 输出截断

工具结果有多层控制：

| 层次 | 目的 |
|------|------|
| Main 进程流式缓冲上限 | 防止 stdout/stderr 无限增长导致内存问题 |
| 命令输出 tail 截断 | 保留近期有效日志 |
| Renderer 工具结果截断 | 控制写入消息数据的大小 |
| UI 错误截断 | 避免错误 JSON 或长 stderr 撑爆工具卡片 |

原则：会话消息中只保存摘要、路径和短预览；大内容写入文件，按需读取。

## 操作日志关联

`user_exec` 和 `code_execution` 都会把 `sessionId`、`toolCallId` 传到 Main 进程。Main 进程为每次执行生成 `operationId`，记录命令或代码哈希、有限预览、运行目录、超时、耗时、退出码和 stdout/stderr 字节数。成功执行不记录输出正文；失败和超时只保留脱敏后的有限预览。这样可以从消息中的 tool call 精确关联到本地执行日志，同时控制日志体积。

## 平台和模型门控

- 桌面端：可创建 `LocalSandboxProvider`，支持 Agent Mode。
- Web/Mobile：不启用 Agent Mode，不注入 agent 工具，保持纯文本对话上下文干净。
- 弱工具模型：DeepSeek R1、V3、V3.2 等 v4 以下模型禁用 agent scope。
- Web Search 是独立能力，不因为 Agent Mode Off 自动关闭。

## 测试覆盖

重点测试：

- `agent-harness.test.ts`：有效模式计算、harness 准备。
- `agent-mode-suggestion.test.ts`：首轮建议分类器的 prompt 构造与决策解析。
- `tools-builder.test.ts`：不同 agent mode、code execution provider、web search、sandbox_* 不可见。
- `agent-mode-orchestration.test.ts`：暂停/继续、流持久化和 append 行为。
- `code-execution.test.ts`：懒初始化、文件注入、执行和错误处理。
- `file-read.test.ts`：分页读取、JSON 字节预算和大输出结构完整性。
- `manager.windows.test.ts`：Windows 原生 Node/PowerShell、无 Bash 文件读写/目录列表、ripgrep 搜索与相对路径下载持久化。
- `user-exec-whitelist.test.ts`：自动审批白名单。
- 文件工具与 UI 组件测试：暂停审批、timeline、产物展示、HTML 预览。

## 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Chat 工具形态 | 高层 `code_execution` 替代 `sandbox_*` | 降低模型误用底层 shell/file 工具的概率 |
| 运行时 | Node.js、PowerShell（Windows）、可选 Bash，不内置 Python 科学栈 | 控制安装包体积和签名风险，核心文件工具不依赖 Shell |
| Auto 进入条件 | 首轮快速分类模型建议 + 用户手动确认，移除文件类型自动升级 | 避免误判，把控制权交回用户，减少纯文本对话的上下文污染 |
| 暂停机制 | 持久化 `paused` tool call | 重启可恢复，继续后能 append 到原消息 |
| HTML 预览 | 本地 preview server + 沙箱相对路径 | 支持相对资源文件，不依赖远端 artifact 域名 |
| 工具结果 | 小结果入消息，大结果入文件 | 控制 session 数据体积和上下文缓存压力 |

## 参考资料

- 产品说明：[`docs/product/code-execution.md`](../product/code-execution.md)
- 工具与集成系统：[`./tools-and-integrations.md`](./tools-and-integrations.md)
- Agent Skills：[`./agent-skills.md`](./agent-skills.md)
