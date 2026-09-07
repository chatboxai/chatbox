# 工具与集成系统

> Last updated: 2026-08

本文档描述 Chatbox Pro 的工具（Tool）与外部集成系统的产品设计。关于整体架构和进程模型，请参阅 [`./architecture.md`](./architecture.md)。

---

## 系统概览

Chatbox Pro 的工具系统为 AI 模型提供外部能力调用，使模型不仅能生成文本，还能执行搜索、读取文件、查询知识库、调用第三方服务等操作。当前工具系统由三个独立层次组成：

| 层次 | 位置 | 职责 |
|------|------|------|
| MCP 服务器 | Main 进程 + Renderer 控制器 | 管理外部 MCP 服务器连接，提供第三方工具 |
| 内置工具集（Toolsets） | `src/renderer/packages/model-calls/toolsets/` | 文件读取、知识库查询、网页搜索等内置工具 |
| Web Search 引擎 | `src/renderer/packages/web-search/` | 多搜索供应商的抽象层与执行器 |

这三层最终在 AI 调用时被统一合并为 Vercel AI SDK 的 `ToolSet`，传递给模型执行。

另有一类与工具构建紧耦合的能力是 **Agent Skills**：它不是传统的业务 API 工具，而是通过元数据注入 + 按需加载工具扩展模型行为。详细设计见 [`./agent-skills.md`](./agent-skills.md)。

## MCP 集成

### 设计动机

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 是一种开放协议，允许 AI 模型通过标准化接口调用外部工具。Chatbox Pro 集成 MCP 的目的是让用户可以自由扩展 AI 的能力边界——无需修改应用代码即可接入新工具。

### 传输层架构

MCP 支持两种传输方式，分别解决不同部署场景：

**Stdio 传输**：通过 Main 进程管理子进程。由于浏览器环境无法直接启动子进程，采用 IPC 代理模式——Renderer 侧的 `IPCStdioTransport`（`src/renderer/packages/mcp/ipc-stdio-transport.ts`）通过 Electron IPC 调用 Main 进程中的 `StdioClientTransport`（`src/main/mcp/ipc-stdio-transport.ts`），Main 进程负责子进程的生命周期管理、stderr 日志采集和编码检测。

**HTTP 传输**：直接从 Renderer 发起 HTTP 请求并优先使用 Streamable HTTP。Legacy 模式保留现有 SSE（Server-Sent Events）降级；Auto 模式仅在端点明确返回 404 / 405 时尝试 SSE，认证错误、服务端错误和网络故障不会被误判为协议不兼容。此模式不依赖 Main 进程，因此在 Web 端和移动端同样可用。

### MCP 协议版本策略

- 内置 MCP 固定使用 legacy 初始化流程，保持现有云端服务行为不变。
- 新建、推荐列表安装和 JSON 导入的自定义 MCP 默认使用 **Auto**：先通过 `server/discover` 协商 2026-07-28 协议；服务端不支持时回退到 legacy `initialize`。
- 升级前已保存且没有 `protocolMode` 的自定义 MCP 按 **Legacy** 处理。用户可以在编辑服务器时手动切换 Auto / Legacy，切换后运行时会重连。
- 2026-07-28 路径当前覆盖工具发现与工具调用主链路。`input_required` 交互、现代订阅以及浏览器环境下的 `x-mcp-header` 参数头镜像暂未接入。
- 少数 stdio 服务收到未知的 `server/discover` 后会直接退出，无法在同一子进程上回退；此类服务应显式选择 Legacy。

### 服务器管理

`mcpController`（`src/renderer/packages/mcp/controller.ts`）是 MCP 服务器的运行时管理中心：

- **生命周期管理**：根据用户配置启动/停止/更新服务器实例，配置变更时自动重连
- **状态订阅**：通过 Emittery 事件系统暴露服务器状态（idle / starting / running / stopping），UI 可实时反映连接状况
- **工具聚合**：`getAvailableTools()` 遍历所有运行中的服务器，将其工具合并到统一的 `ToolSet` 中；工具名通过 `mcp__<serverName>__<toolName>` 格式命名以避免冲突
- **错误容忍**：单个 MCP 工具执行失败时返回错误信息而非抛出异常，避免中断整个对话流程

### 内置 MCP 服务器

Chatbox Pro 预置了一组云端 MCP 服务器（`src/renderer/packages/mcp/builtin.ts`），通过 HTTP 传输连接到 `mcp.chatboxai.app`：

- **Fetch**：网页内容抓取与 HTML 转 Markdown
- **EdgeOne Pages**：HTML 内容部署与公开 URL 获取
- **arXiv**：学术论文检索
- **Context7**：编程库文档与代码示例检索

内置服务器需要许可证密钥认证（通过 `x-chatbox-license` 请求头传递），用户无需额外配置即可使用。

## Web Search 系统

### 多供应商架构

Web Search 采用抽象基类模式（`src/renderer/packages/web-search/base.ts`），定义统一的 `search(query, signal)` 与可选的 `parseLink(url, signal)` 接口，各供应商实现具体逻辑：

| 供应商 | 文件 | 网页搜索 | 读取网页（parseLink） | 特点 |
|--------|------|---------|----------------------|------|
| Chatbox Search | `chatbox-search.ts` | ✓ | ✓ | 内置搜索，需许可证密钥（任意 tier 均可使用 parse_link） |
| Bing | `bing.ts` | ✓ | ✗ | 免费使用，国际覆盖 |
| Bing News | `bing-news.ts` | ✓ | ✗ | 新闻专项搜索，非中文环境自动启用 |
| Tavily | `tavily.ts` | ✓ | ✓（调用 `/extract`） | 高质量 AI 搜索，需用户自备 API Key |
| BoCha | `bocha.ts` | ✓ | ✗ | 国内搜索 API |
| Querit | `querit.ts` | ✓ | ✗ | 多源聚合搜索 |

每个供应商通过 `supportsParseLink` 实例标志声明自己是否实现了 `parseLink`。基类默认返回 `false`，需要的子类用 `override supportsParseLink = true` 显式声明。

基类还封装了跨平台的 HTTP 请求能力：移动端通过 Capacitor HTTP 插件发起请求（绕过 CORS 限制），桌面端和 Web 端使用 `ofetch`。

### parse_link 能力的双源一致性

`parse_link` 工具的注入逻辑用静态集合 `PROVIDERS_WITH_PARSE_LINK`（在 `web-search/index.ts` 中导出）作为单一数据源，被 `tools-builder.ts`（决定是否注入工具）和设置 UI（展示能力勾选）共享。

为防止该集合与各 provider 类的 `supportsParseLink` 标志漂移，`parse-link-consistency.test.ts` 在每次测试时实例化所有 provider 并断言两边一致。新增 provider 或为现有 provider 启用 parseLink 时，**必须同时更新两处**，否则测试失败。

### 搜索执行流程

搜索入口（`src/renderer/packages/web-search/index.ts`）实现了以下设计：

1. **供应商选择**：根据用户设置（`extensionSettings.webSearch.provider`）动态实例化搜索供应商
2. **并行搜索**：同时调用所有选中的供应商，结果交替合并（round-robin），确保多源覆盖
3. **结果缓存**：使用 5 分钟 TTL 缓存（`cachified`），避免重复搜索相同查询
4. **结果截断**：最多返回 10 条结果，每条摘要截断至 150 字符，控制上下文窗口消耗

## Tool 系统（内置工具集）

### Toolset 架构

内置工具定义在 `src/renderer/packages/model-calls/toolsets/` 目录下，每个工具集导出统一结构：

```
{ description: string, tools: ToolSet }
```

其中 `description` 会被注入到系统提示词中，引导模型正确使用工具；`tools` 是 Vercel AI SDK 的工具定义。

### 文件工具集（`toolsets/file.ts`）

为 AI 提供读取和搜索用户上传文件的能力：

- **read_file**：按行号范围读取文件内容（类似 `cat -n`），支持分页，默认 200 行
- **search_file_content**：在文件中搜索关键词，支持上下文行数配置

设计要点：仅对超过阈值行数的大文件启用工具调用；小文件直接内联到上下文中，避免不必要的工具调用开销。

### 知识库工具集（`toolsets/knowledge-base.ts`）

与本地 RAG 知识库交互，提供四个工具：

- **query_knowledge_base**：语义搜索，模型被要求对每个新问题都先执行搜索
- **get_files_meta**：获取文件元数据
- **read_file_chunks**：按块读取文档内容
- **list_files**：分页列出所有文件

工具集的 `description` 动态生成，包含知识库名称和文件列表，使模型了解可检索的内容范围。

### Web Search 工具集（`toolsets/web-search.ts`）

暴露两个工具给 AI 模型调用：

- **web_search**：调用上述 Web Search 系统执行搜索
- **parse_link**：抓取并解析指定 URL 的可读内容

`parse_link` 在 `execute` 中按所选搜索提供方分派：

| 提供方 | 执行路径 | 失败模式 |
|--------|---------|---------|
| `build-in` (Chatbox AI) | 检查 `licenseKey` → 调用 `remote.parseUserLinkPro` | 缺 license 抛 `chatbox_search_license_key_required`（后端不限制 tier，任意 license 均可调用） |
| `tavily` | `getParseLinkProvider().parseLink()` → Tavily `/extract` API | 缺 API key 抛 `tavily_api_key_required`；提取空抛 `parse_link_failed` |
| 其他（`bing` / `bocha` / `querit`） | 不会注入 `parse_link`，模型看不到此工具 | — |

错误抛出采用 AI/用户双层结构：`Error.message`（传给 `ChatboxAIAPIError` 构造器的第一参数）携带技术原因供 AI 推理（例如 "Tavily extract API returned no results for {url}"），`detail.i18nKey` 则给用户渲染本地化的友好提示。

工具的 `execute` 函数同时透传 `abortSignal`，使内置和第三方两条路径在用户取消工具执行时都能中止底层 HTTP 请求。`remote.parseUserLinkPro` 接收可选的 `abortSignal`，并通过 `afetch` 的 `RequestInit.signal` 透传到底层 fetch。

### 工具错误的用户可见渲染

工具抛出的 `ChatboxAIAPIError` 在 UI 上有两条独立的渲染路径：

```
tool execute throws ChatboxAIAPIError
        │
        ▼
ai SDK 把异常转成 tool-error chunk
        │
        ▼
stream-chunk-processor.ts
  - 把 chunk.error.message 存到 result.error
  - 把 chunk.error.code (BaseError) 存到 result.errorCode
        │
        ▼
ToolCallPartUI (ParseLinkUI / WebSearchGroupUI / GeneralToolCallUI)
  - state === 'error' 时通过 useAutoExpandOnError() 自动展开详情
  - <ToolCallErrorDetails> 读 result.errorCode
        │
        ▼
<ChatboxAIErrorMessage errorCode={code} />
  - ChatboxAIAPIError.getDetail(code) → i18nKey
  - <Trans> 渲染 OpenSettingButton / OpenExtensionSettingButton /
    OpenMorePlanButton 等可点击的跳转链接
```

`ChatboxAIErrorMessage`（`src/renderer/components/common/ChatboxAIErrorMessage.tsx`）是从 `MessageErrTips` 抽出来的可复用组件，确保同一个 ChatboxAI error code 在「消息级错误」和「工具级错误」两种位置展示一致。如果错误不是已知的 `ChatboxAIAPIError`，组件返回 `null`，`ToolCallErrorDetails` 回退显示原始错误字符串。

## Tool 构建与注入

工具在 AI 生成调用前由 `buildToolsForSession()`（`src/renderer/stores/session/tools-builder.ts`）动态组装，调用方（`agent-harness.ts` 与 `adapters/CurrentGenerationService.ts`）把结果传给模型：

1. **模型能力检查**：Agent 工具需要模型支持 `agent` scope；Web Search 使用独立的 `web-browsing` scope。
2. **Web Search 工具**：当会话启用网页浏览且模型支持 `web-browsing` 时启用，独立于 Agent Mode。
3. **文件工具**：没有 code execution provider 时，为附件文件/链接注入轻量读取工具。
4. **Session Attachment RAG**：当会话已有 attachment ids 且模型支持 `read-file` 时注入。
5. **Agent 工具**：编排层把 Auto 解析为有效的 On/Off；仅当有效模式为 On 且模型支持 `agent` scope 时，注入 code execution、文件系统、MCP、知识库、Skills 和 `user_exec`。
6. **工具说明注入**：各工具集的 `description` 和 Skill 元数据被收集并注入到系统提示词中。

## Agent Skills 与 Tool 构建

Skills 集成沿用 `buildToolsForSession()` 返回的 `{ tools, instructions }` 模式：

1. 在 `instructions` 中注入启用的技能元数据列表
2. 在模型支持 Tool Use 时注册 `load_skill` 工具
3. 由模型在命中场景时再加载技能全文（渐进披露）

这样既保留了技能扩展能力，也避免在每次请求中注入所有技能正文带来的 token 膨胀。

`buildToolsForSession()` 函数（`src/renderer/stores/session/tools-builder.ts`）已实现，统一封装上述逻辑，返回 `{ tools, instructions }` 结构。调用方（`agent-harness.ts` / `adapters/CurrentGenerationService.ts`）使用该函数完成工具组装。

### Skills 相关工具

Agent Mode 下注册 Skills 相关工具：

| 工具 | 说明 | 门控 |
|------|------|------|
| `load_skill` | 按名称加载技能全文指令 | 始终可用（auto 模式初始即可调用） |
| `chatbox_cli` | Chatbox 产品 Skill 的受控虚拟 CLI（账号、只读设置、历史会话、异步生图） | 仅当内置产品 Skill 启用时注入；设置修改由模型引导用户在 UI 中完成；生图使用专属本地化审批卡，批准后等待后台回调而非模型轮询 |
| `user_exec` | 在用户真实环境执行命令，内置审批机制 | Auto 初始隐藏，加载 Skill 后可用 |
| `install_skill` | 从沙箱路径安装技能（需 codeExecution） | code execution 可用时注入，Auto 初始可见 |

`user_exec` 不再在 Auto 初始阶段暴露，避免未加载 Skill 时模型直接尝试操作用户真实环境。`install_skill` 保留为可见工具，用于从已准备好的沙箱路径安装新技能。

### Claude Code Skills 发现

`discoverClaudeSkills()`（`src/main/skills/discovery.ts`）扫描 `~/.claude/skills/` 目录：

- 跟随 symlink（`fs.statSync` + `fs.realpathSync`），按真实路径去重
- 名称规范化为 kebab-case（`normalizeClaudeSkillName`）
- Chatbox Skills 同名时优先（`excludeNames` 参数）
- `source.type` 标记为 `'claude-code'`

### Skills 发现缓存

Renderer 侧缓存发现结果 30 秒（`SKILLS_CACHE_TTL`），避免每次生成发起 IPC 调用。安装/删除技能后调用 `resetSkillsCache()` 强制刷新。

## 已完成的重构

### chatStream 与工具构建

Model Chat Refactor 中的核心部分已落地：

- **chatStream()**：Model 接口已定义 `chatStream()` 方法（`src/shared/models/types.ts`），返回 `AsyncGenerator<ModelStreamPart>`，暴露流式事件（包括工具调用状态和自定义 `status` 事件）
- **buildToolsForSession()**：统一工具构建函数（`src/renderer/stores/session/tools-builder.ts`），根据会话配置和模型能力组装工具集与系统提示词注入指令
- **Orchestration 层**：GenerationService（`packages/chatbox-core/src/generation/GenerationService.ts`，renderer 经 `currentGenerationService` 调用）组合 ContextBuilder → buildToolsForSession → chatStream 完成完整的 AI 调用流程

## Code Execution 工具集（Chat 模式）

Chat 模式引入了第五类工具集——Code Execution 工具集（`toolsets/code-execution.ts`），为 Chat 对话中的 AI 提供代码执行、文件读取和文件生成能力。包含 3 个核心工具：`code_execution`（代码执行）、`read_file`（文件读取，支持行级分页）、`create_download`（文件下载）。另有 3 个 Skills 相关辅助工具：`load_skill`、`user_exec`（用户环境命令执行，含审批机制）、`install_skill`（沙箱安装技能）。

Code Execution 面向 Chat 用户（隐藏底层沙箱细节、自动临时目录、文件上传注入、产物展示），通过 Agent Mode 控制注入。旧的 `sandbox_*` toolset 已移除，历史消息由通用 tool-call UI 按工具名继续渲染。

文件读取和单目录列表通过结构化 Node helper 完成；递归发现和内容搜索使用应用内置 ripgrep；本地产物下载直接走持久化接口。因此核心文件工具在 Windows 上不依赖 Bash 或 WSL。

详细技术设计参见 [`./code-execution.md`](./code-execution.md)。

## 尚未实现的方向

### 统一 ToolRegistry

工具的注册与管理目前仍分散在三个不同位置（MCP 控制器、内置 toolsets、Web Search 包）。架构重构中提出了 **ToolRegistry** 方案，但尚未实现：

- **计划位置**：`src/shared/ai-service/tool-registry/`
- **统一接口**：定义 `AITool` 接口（name, description, parameters, execute），所有工具实现相同接口
- **注册模式**：参考 Provider Registry（`src/shared/providers/registry.ts`）的 `defineProvider()` 模式
- **零 Renderer 依赖**：ToolRegistry 放在 `src/shared/` 下，可独立测试
