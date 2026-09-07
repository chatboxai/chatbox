# Agent Soul 与 Memories(智能体人格与记忆)

## 背景与动机

Agent mode(工作模式)此前沿用会话级 system prompt:用户可以为每个会话单独设置系统提示词。这带来两个问题:

1. **身份不可控**:会话级 prompt 可以完全覆盖 agent 的身份定义,工具指令与人设互相干扰。
2. **Prompt cache 不稳定**:system prompt 的开头注入了 `Current date`(每天变化),workspace AGENTS.md 在每次生成时从磁盘重读(文件变化即失效),导致 provider 端 prefix cache 频繁击穿。

参考 Hermes(NousResearch/hermes-agent)、OpenClaw 与 Claude Code / Codex 的做法,agent mode 改为**全局 Soul 文档 + 智能体记忆 + 冻结快照**的架构。

## 核心设计

### Prompt 分层(按稳定性排序)

Agent mode 的 system prompt 由 harness 自行组装(不再走 `injectModelSystemPrompt`),从最稳定到最易变:

```
1. Identity header(内置,随 app 版本)   You are Chatbox agent... Current platform: Desktop (macOS)
2. ## Soul(快照)                        用户编辑的人格/语气/边界;空时回退到内置默认人格
   └ Copilot overlay(快照,可选)        本会话选中的 Copilot 人设,拼在 Soul 正文之后
3. ## Memories(快照)                    save_memory 写入的条目,带 [id] 前缀
4. 工具指令(含 Workspace Instructions 快照)
5. ## Runtime                            Current model + Session context captured(快照日期,非当天日期)
```

有 Copilot 的会话把 Copilot prompt 冻结进 `sessionPromptContextSnapshot.copilotPersona`(长度上限 `COPILOT_PROMPT_MAX_CHARS`=40000,与创建/编辑表单一致),组装时拼进 `## Soul` 段(全局 Soul 在前,Copilot 在后);无 Copilot 的会话级 system prompt 不进入请求。Chat mode 路径完全不变:会话 system prompt 仍作为独立消息发送。界面上工作模式仍隐藏系统提示词入口(身份由 Soul 段表达,见[聊天/工作模式分化](./chat-work-mode-split.md));存储中的 system 消息与 `copilotId` 不动。

### 冻结快照(SessionPromptContextSnapshot)

- **捕获时机**:会话首次以 agent mode 生成时,一次性读取 Soul + memories + workspace AGENTS.md,并把本会话 Copilot 人设(若有 `copilotId`)冻进 `copilotPersona`,存入 `session.settings.sessionPromptContextSnapshot`。
- **会话期间只读**:Soul/memories/AGENTS.md 的任何中途修改都只写存储,不影响进行中的会话——system prompt 前缀 byte 级稳定,prefix cache 不失效。这与 Hermes 的 "frozen MEMORY snapshot" 语义一致。
- **刷新路径**:
  - 新 thread(`refreshContextAndCreateNewThread`)与压缩建 thread(`compressAndCreateThread`)清除快照,下次生成重新捕获(上下文重置,cache 本来就没了,免费刷新点);
  - working directories 变更时自动重新捕获(用户显式操作,可接受的 cache 失效);
- Schema 见 `src/shared/types/agent-persona.ts`(zod,`.catch()` 防旧版本回退解析失败),`version` 字段预留迁移。

### 动态能力刷新(Skills / Plugins)

- Skills、Plugins、MCP 与其他工具能力不属于 `SessionPromptContextSnapshot`;它只冻结 Soul、Memories 与 workspace instructions。
- 能力列表与对应工具指令在每次 generation 开始时重新解析。安装、删除或更新能力后应发送 change event 清除 discovery cache;启用/禁用状态直接从当前 settings 读取。
- 因此当前会话无需重启或新建 thread:下一次用户消息使用新的能力集合。已经开始的 generation 保持其启动时的工具集合,避免中途改变一次 provider 调用的语义。
- 能力变化会自然改变最终 system prompt/tools;这是用户显式操作导致的可接受 prompt-cache break,不应顺带刷新 Soul、Memories 或 AGENTS.md 快照。

### Soul 文档

- 全局唯一,存储 key `agent-soul`(平台 storage,非文件系统)。
- 首次读取时按用户当前 UI 语言初始化分节模板(Personality & Tone / Principles / Boundaries,i18n key 生成)。模板全部由标题、引用行和 HTML 注释构成,`extractSoulContent` 会剥离这些脚手架——**未编辑的模板视为空**,回退到内置默认人格,不会向 prompt 注入占位文案(避免了 Hermes 式的模板指纹比对)。
- 上限 `SOUL_MAX_CHARS`(16K 字符),超出截断并加 marker。
- **虚拟路径** `chatbox://SOUL.md`:`read_file` / `write_file` / `edit_file` 拦截该路径,读写 app 存储。显式 scheme 避免与用户目录中真实的 SOUL.md 冲突。sandbox 内的 shell(`cat` 等)看不到该文件,工具指令中已注明必须走文件工具。
- 用户编辑入口:Settings → Agent(智能体)设置页(桌面端,跟随 skills feature flag;页面同时承载 Smart Switching 默认开关)。

### Memories

- 全局条目列表,存储 key `agent-memories`,每条 `{ id, content, createdAt }`。
- 工具:`save_memory`(新增)/ `delete_memory`(按 id 删除),**Chat/Work 两种模式均注册**(经 `agent` tool-use scope 排除弱 function-calling 模型)。写入立即持久化,但**当前会话保持快照不变**——工具描述明确告知模型"只影响未来会话",且要求按用户界面语言书写条目。
- Chat mode 同时经快照注入 `## Memories` 段(不含 Soul/身份);快照仅在**会话首个回合**且记忆非空时捕获——中途出现的记忆(包括本会话刚用 save_memory 写入的)只对未来会话生效,与工具描述的冻结承诺一致,也避免全量会话产生快照写入。
- **全局开关**:Settings → Agent 的"记忆"开关(`settings.memoryEnabled`,缺省开启)。关闭后两种模式都不注册工具、不注入记忆;Soul 不受影响。
- 上限:100 条 / 单条 1000 字符;注入预算 8K 字符,超出时优先保留最新条目并加省略 marker。
- 用户管理:Settings → Agent(智能体)设置页的记忆列表(查看/删除)。
- 本地导入:桌面端打开 Settings → Agent 时,主进程只扫描 Codex `~/.codex/memories/memory_summary.md`、Claude 用户级 `~/.claude/CLAUDE.md` 和 `~/.claude/rules/**/*.md`。明确不读取 Claude `~/.claude/projects/*/memory/` 项目记忆,避免项目知识进入 Chatbox 全局 Memories。解析后的候选记忆会先在 review 弹窗中展示来源和路径,由用户逐条勾选确认后才写入;不会扫描其他目录、自动导入聊天历史或未经确认修改 Chatbox 记忆。导入继续复用去重、100 条和单条 1000 字符限制。
- v2 预留:长期事实/事件日志双层结构,或 daily log + `memory_search`(OpenClaw)按需检索架构;当前扁平列表在 100 条内足够。

### Workspace AGENTS.md 的 cache 修复

此前 `buildWorkspaceInstructions` 每次生成都重读磁盘并嵌入 system prompt。参考 Claude Code / Codex(AGENTS.md 在 session 开始时加载进首条消息、会话期间不重读),现在 agent mode 将 workspace instructions 一并纳入快照(`workspaceInstructionsOverride`),文件中途变更不再击穿 cache;要生效需新 thread,working directories 变更时也会自动重新捕获。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/shared/types/agent-persona.ts` | Schema、上限常量、`SOUL_VIRTUAL_PATH` |
| `src/shared/agent-persona/prompt.ts` | 纯函数 prompt 组装(identity/soul/copilot overlay/memories),shared 供 native 复用 |
| `src/shared/agent-persona/memory-import.ts` | Markdown/TXT/JSON 记忆文件解析与聊天历史识别 |
| `src/main/agent-persona/local-memory-scanner.ts` | 固定位置的 Claude/Codex 本地记忆发现与解析 |
| `src/renderer/stores/agentPersonaStore.ts` | Soul/memories 存储 CRUD、模板初始化、快照捕获 |
| `src/renderer/stores/session/agent-harness.ts` | system prompt 组装;会话 system 消息从 transcript 去掉,Copilot 人设经 Soul 段注入 |
| `src/renderer/stores/session/prompt-context-snapshot.ts` | 快照解析策略(agent/chat 两种模式的捕获与复用规则) |
| `src/renderer/stores/session/agent-mode.ts` | `persistSessionPromptContextSnapshotGuarded`(CAS 防护的快照持久化) |
| `src/renderer/packages/model-calls/toolsets/agent-memory.ts` | save_memory / delete_memory 工具 |
| `src/renderer/packages/model-calls/toolsets/soul-file.ts` | 虚拟路径读写桥 |
| `src/renderer/packages/model-calls/workspace-instructions.ts` | AGENTS.md 读取(从 tools-builder 抽出) |
| `src/renderer/routes/settings/agent.tsx` + `components/settings/agent-persona/` | Agent 设置页(Smart Switching 默认开关 + Soul 编辑器 + 记忆管理) |

## 兼容性

- 存量会话的 system prompt 与 `copilotId` 数据不动。Agent mode 生成路径把 Copilot 人设冻进快照并拼进 Soul;无 Copilot 的会话级 system prompt 仍不进入请求。Chat mode 与 Copilot 选择入口不变。
- `sessionPromptContextSnapshot` 为 optional + `.catch(undefined)`;旧的 `agentPromptSnapshot` 尚未进入正式版,不保留字段迁移。
- 新存储 key(`agent-soul` / `agent-memories`)为增量添加,不涉及 IndexedDB 版本变更。
