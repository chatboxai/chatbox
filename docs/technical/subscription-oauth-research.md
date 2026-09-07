# Cursor / OpenCode 订阅登录调研

> Last updated: 2026-08

本文记录把「Cursor 订阅」和「OpenCode 订阅」接到 Chatbox 时的登录机制结论，以及为什么最终只落地 OpenCode 官方 API Key 提供商（Zen 与 Go 两个网关）。

相关实现：

| 文件 | 职责 |
|------|------|
| `src/shared/providers/definitions/opencode-shared.ts` | 两个 OpenCode 网关共用的路由规则、模型类工厂与 `createModel` 分发 |
| `src/shared/providers/definitions/opencode-zen.ts` | OpenCode Zen 内置提供商：按模型路由 Responses / Anthropic Messages / Google / Chat Completions |
| `src/shared/providers/definitions/opencode-go.ts` | OpenCode Go 内置提供商：按模型路由 Responses / Anthropic Messages / Chat Completions |
| `src/main/oauth/` | 现有桌面端官方 OAuth（OpenAI / Claude / Copilot / Qwen Portal / MiniMax） |
| `src/shared/oauth/provider-mapping.ts` | Chatbox provider id → OAuth provider id |
| `docs/technical/ai-providers.md` | Provider 注册表与 OAuth 总览 |

## 1. Chatbox 现有登录面

Chatbox 桌面端已经支持三类官方 OAuth，全部挂在 `src/main/oauth/`，由设置页 `useOAuth` 触发：

| Flow | 代表供应商 | 机制 |
|------|------------|------|
| Callback | OpenAI / OpenAI Responses | 本地 callback server + PKCE |
| Code-paste | Claude | 浏览器授权后把回调地址 / 授权码贴回应用；`state` 必须复用 PKCE verifier |
| Device-code | GitHub Copilot、Qwen Portal、MiniMax | 展示 `user_code`，主进程轮询换 token |

这些流程都对应**官方、公开的聊天 API**。OAuth 只解决凭证，`createModel()` 仍然打公开的 Chat Completions / Responses / Messages / Copilot 端点。

## 2. OpenCode：没有 OAuth，只有控制台 API Key

OpenCode 是两个独立计费产品，共用一套控制台和 API Key 创建入口：

| | Zen | Go |
|---|---|---|
| 计费 | 按量付费（余额 + auto-reload） | 订阅，首月 $5，之后 $10/月 |
| 端点 | `https://opencode.ai/zen/v1` | `https://opencode.ai/zen/go/v1` |
| 官方 config 前缀 | `opencode/<model-id>` | `opencode-go/<model-id>` |
| 目录 | 全量（GPT / Claude / Gemini / Grok + 开源模型 + 若干免费模型） | 仅开源系模型 + Grok 4.5 / GPT 5.6 Luna |
| 限额 | 无（按花费） | 5h $12 / 周 $30 / 月 $60，可回落到 Zen 余额 |

因为是两套端点、两份目录、两套路由，Chatbox 也做成两个 provider，名字保留上游的 `Zen` / `Go` 区分。

官方文档：https://opencode.ai/docs/zen/ 、https://opencode.ai/docs/go/

- 订阅价：$5 首月，之后 $10/月，在 OpenCode Zen 控制台开通。
- 登录方式：在 https://opencode.ai/auth 创建 **API Key**，再粘贴到客户端。OpenCode 自己的 TUI 也是 `/connect` → 选 OpenCode Go → 粘贴 key。
- Zen OAuth 仍是未交付的社区需求（anomalyco/opencode 讨论 8526 已因闲置关闭），**没有可对接的授权码 / device-code / callback 端点**。
- 公开 REST 根路径：`https://opencode.ai/zen/go/v1`
- `GET /zen/go/v1/models` 返回 OpenAI 形 catalog，可以无鉴权访问；实际推理请求需要 `Authorization: Bearer <key>`（Chat Completions / Responses）或 `x-api-key`（Anthropic Messages）。

官方按模型拆了三种上游协议（必须按 model id 路由，不能只认 provider type）：

| 表面 | 模型 | 鉴权 |
|------|------|------|
| `POST /v1/responses` | `grok-*`、`gpt-*`、`muse-spark*` | Bearer |
| `POST /v1/messages` | `minimax-*`、`qwen3.*` | `x-api-key`（Bearer 会被 Go 当成 Missing API key） |
| `POST /v1/chat/completions` | GLM / Kimi / DeepSeek / MiMo / Hy3 等 | Bearer |

Zen 的表面多一层 Google，且 MiniMax 落点与 Go 不同：

| 表面 | 模型 | 鉴权 |
|------|------|------|
| `POST /v1/responses` | `gpt-*`、`grok-*`、`muse-spark*` | Bearer |
| `POST /v1/messages` | `claude-*`、`qwen3.*` | `x-api-key` |
| `POST /v1/models/<id>:*` | `gemini-*` | Google generative API（host 不带 `/v1beta`） |
| `POST /v1/chat/completions` | DeepSeek / MiniMax / GLM / Kimi / 免费模型 | Bearer |

因此 Chatbox 的正确产品形态是：**内置 `opencode-zen` / `opencode-go` 两个提供商 + API Key + 按模型分发到已有的 `OpenAIResponses` / `CustomClaude` / `CustomGemini` / `OpenAI` 实现**。这和 GitHub Copilot「订阅网关」类似，但 Copilot 有官方 device-code；Go 没有。

## 3. Cursor 订阅：CLI 登录存在，公开聊天 API 不存在

社区与 `@cursor/sdk` 对 Cursor CLI 登录的描述一致（与 Chatbox 现有三类 OAuth 都不相同）：

1. 生成 PKCE verifier（随机字节 → base64url）和 `challenge = base64url(sha256(verifier))`，再生成一次性 `uuid`。
2. 打开 `https://cursor.com/loginDeepControl?challenge=&uuid=&mode=login&redirectTarget=cli`。
3. 轮询 `https://api2.cursor.sh/auth/poll`（较新的 SDK 要求 **POST body 带 verifier**，旧实现是 GET query；pending 时返回 404）。指数退避约 1s → 10s，大约 150 次。
4. 刷新：`POST https://api2.cursor.sh/auth/exchange_user_api_key`，`Authorization: Bearer <refreshToken>`，body `{}`。

这条登录只能证明「这台机器完成了 Cursor CLI 握手」。它**不能**接上一个公开的 OpenAI 兼容聊天端点。

官方可编程入口目前是：

- Cursor CLI（`cursor-agent` / ACP）
- Agent SDK
- Cloud Agents API（`https://api.cursor.com`，`crsr_...` key）

这三条都跑 Cursor 自己的 agent harness，不是 raw `chat/completions`。论坛上的官方答复写明：第三方用订阅 token 打 `api2.cursor.sh` 的私有 Connect/gRPC（`AgentService/Run` 等）属于 ToS Use Restrictions（逆向 / 访问内部结构），可能触发封号；本地 OpenAI 兼容反向代理也算同一类。公开的 `/v1/chat/completions` 仍是功能请求，不是已上线产品。

因此 Chatbox **不能**做这些事：

- 实现 Cursor CLI OAuth 后再去打 `api2.cursor.sh` 私有聊天 RPC
- 在设置页放「Sign in with Cursor」却没有合法的后续聊天 API（空登录）
- 把 Cloud Agents API 伪装成普通会话模型（语义是异步 agent job，不是 Chatbox 的 `getModel()` 流）

等 Cursor 提供官方、可用于第三方客户端的聊天 API 后，再单独评估：是接 Cloud Agents、还是接未来的 OpenAI 兼容面、以及登录是 `crsr_` key 还是 CLI PKCE。

## 4. 落地决策

| 供应商 | 官方登录 | 官方聊天 API | Chatbox 本次动作 |
|--------|----------|--------------|------------------|
| OpenCode Zen | 控制台 API Key | 有，且按模型分四种协议 | 新增内置提供商 `opencode-zen` |
| OpenCode Go | 控制台 API Key | 有，且按模型分三种协议 | 新增内置提供商 `opencode-go` |
| Cursor 订阅 | CLI PKCE + `auth/poll` | 无公开 raw chat API | 不实现 OAuth，不实现私有 RPC |

两个 OpenCode 网关在 Chatbox 里的行为约束：

- 不加入 `src/main/oauth/`，也不写入 `OAUTH_PROVIDER_MAP`。
- `ModelProviderType.OpenAI` 只决定设置页按 API Key + Host 展示；真正的请求类由 `getOpenCodeZenApiStyle()` / `getOpenCodeGoApiStyle()` 决定。
- 两者的模型目录都是 OpenAI 形状的 `/models`，Anthropic / Gemini 子类改为拉这个目录，否则会漏掉混合目录。
- Zen 的 Gemini 直接挂 `<host>/models/<id>`，因此 Gemini 子类覆盖 `getProvider()` 去掉 `CustomGemini` 默认追加的 `/v1beta`。
- Anthropic 表面继续走 `CustomClaude` 的 `apiKey` → `x-api-key`，不要改成 `authToken` / Bearer。
- reasoning-control 把两个网关都当网关处理（与 ChatboxAI 类似，见 `isOpenCodeGatewayProvider()`）：按 `apiStyle` 映射 effectiveProvider，并让 DeepSeek 的 OpenAI 兼容思考历史生效。
