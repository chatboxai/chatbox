# AI 供应商系统

> Last updated: 2026-03

## 概述

Chatbox 的 AI 供应商（Provider）系统负责对接 30+ 家 AI 模型服务商，包括 OpenAI、Claude、Gemini、DeepSeek、Groq、Ollama 等。该系统采用**注册表（Registry）模式**，以 `defineProvider()` 为核心实现供应商的声明式注册，是整个 AI 调用链路的入口层。

设计目标：

- **单一数据源**：每个供应商的所有信息（ID、名称、API 类型、默认配置、模型工厂函数）集中在一个 `defineProvider()` 调用中，消除信息分散的问题。
- **可扩展性**：新增内置供应商只需 4 个文件改动；用户自建供应商通过 `createCustomProviderModel()` 动态支持。
- **关注点分离**：供应商定义（definition）与模型实现（model class）解耦，分别位于 `definitions/` 和 `definitions/models/`。

关于此架构选型的决策记录，参见 [关键决策 #2：Registry 模式](./key-decisions.md)。

## 注册表架构

### 核心机制

供应商系统的注册表位于 `src/shared/providers/registry.ts`，内部维护一个 `Map<string, ProviderDefinition>`。关键 API：

| 函数 | 用途 |
|------|------|
| `defineProvider(def)` | 注册一个供应商定义，返回 `ProviderDefinition` 对象 |
| `getProviderDefinition(id)` | 按 ID 查找已注册供应商 |
| `getAllProviders()` | 获取所有已注册供应商列表 |
| `getSystemProviders()` | 获取供 UI 使用的供应商基础信息列表 |

### 副作用导入（Side-Effect Import）

注册通过 **副作用导入** 触发——在 `src/shared/providers/index.ts` 中，每个供应商定义文件作为副作用被导入：

```typescript
import './definitions/chatboxai'
import './definitions/openai'
import './definitions/claude'
// ... 其余供应商
```

模块加载时 `defineProvider()` 自动执行，将供应商写入注册表。**导入顺序决定了 UI 中供应商的显示顺序**（ChatboxAI 始终排在首位）。

### ProviderDefinition 结构

每个供应商通过 `ProviderDefinition` 接口描述（定义于 `src/shared/providers/types.ts`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | 供应商唯一标识，对应 `ModelProviderEnum` |
| `name` | `string` | 是 | 用于 UI 展示的名称 |
| `type` | `ModelProviderType` | 是 | API 协议类型：`OpenAI`、`Claude`、`Gemini`、`OpenAIResponses` |
| `urls` | `object` | 否 | 相关链接（官网、API Key 申请、文档等） |
| `defaultSettings` | `ProviderSettings` | 否 | 默认 API 地址和预置模型列表 |
| `modelsDevProviderId` | `string` | 否 | 对应 models.dev 的供应商 ID，设置后启用 models.dev 元数据富化与 fallback 模型列表 |
| `curatedModelIds` | `string[]` | 否 | 策展模型 ID 列表，作为默认展示模型。仅在 `modelsDevProviderId` 设置时有意义 |
| `createModel` | `(config) => ModelInterface` | 是 | 模型工厂函数，创建可调用的模型实例 |
| `getDisplayName` | `function` | 否 | 自定义消息头中的显示名称 |

### 模型实例化流程

`getModel()` 是获取模型实例的统一入口（`src/shared/providers/index.ts`）：

1. 根据 `provider` ID 查找注册表
2. 若找到 → 调用 `providerDefinition.createModel(config)` 创建实例
3. 若未找到 → 检查是否为用户自建供应商，通过 `createCustomProviderModel()` 创建
4. 均未匹配 → 抛出错误

### 控制面优先级（Precedence）

Provider / Model 控制面目前有多个来源：provider definition、本地设置、OAuth 共享凭证、provider API 返回、models.dev registry。为了避免行为歧义，优先级固定如下：

| 字段/决策 | 一级来源 | 二级来源 | 三级来源 | 用途 |
|------|------|------|------|------|
| provider 路由 | `provider` session setting | 无 | 无 | 选择实例化哪个 provider |
| provider definition | 内置 registry | custom provider | 无 | 决定 `createModel()`、默认 host/path、显示名 |
| 自定义 provider ID | 必须全局唯一 | 不允许与 builtin 同 ID | 无 | 避免运行时路由歧义 |
| OAuth 凭证 | provider-local settings | shared OAuth settings | 无 | 只共享 credential，不共享 auth mode |
| `activeAuthMode` | provider-local settings | defaultSettings | 无 | 决定当前走 OAuth 还是 API Key |
| `apiHost` / `apiPath` | provider settings | provider defaults | 无 | 请求路由 |
| effective API key | desktop OAuth token | provider settings `apiKey` | 空字符串 | 请求鉴权 |
| model list | user-saved models | backend remote manifest / provider API | curated registry fallback | 设置页模型选择 |
| runtime capability / context / maxOutput | models.dev registry（覆写） | provider defaults / provider API / user-saved model info | 无 | 运行时行为与 UI feature gate |
| release date / status / family | models.dev registry | 无 | 无 | 展示、发现新模型 |

#### 关键约束

- **禁止 builtin/custom 同 ID**
  `customProviders[].id` 不得与任何内置 provider ID 冲突。ID 是运行时路由键、设置主键、OAuth 共享键，不能复用。
- **OAuth 只共享凭证，不共享认证模式**
  例如 `openai-responses -> openai` 只复用 `oauth` token，不复用 `activeAuthMode`。
### 控制面与数据面边界

| 层 | 负责什么 | 不负责什么 |
|------|------|------|
| `ProviderDefinition` | provider contract、默认配置、实例工厂、`modelsDevProviderId` 声明 | 不直接决定消息流或 UI 交互细节 |
| provider ID mapping (`provider-mapping.ts`) | Chatbox ↔ models.dev ID 映射关系（单一数据源） | 不决定 provider 注册或 UI 路由 |
| OAuth mapping / credential manager | 凭证来源、刷新、共享规则 | 不决定模型选择或 capability |
| models.dev registry | 模型元数据权威来源、capability 覆写、fallback 模型列表、新模型发现 | 不负责全局 provider 注册 |
| registry 缓存层 (`fetch.ts`) | 多级缓存（内存→Blob→快照）、fetch 去重、订阅通知 | 不决定富化策略 |
| provider API / user config | 当前 endpoint 的模型配置与运行约束 | 不负责全局 provider 注册 |
| model class (`OpenAI` / `Claude` / ...) | 发请求、收响应、适配具体协议 | 不维护全局 precedence 规则 |

## 模型注册表（Model Registry）

模型注册表系统使用 [models.dev](https://models.dev) 作为外部元数据源，为内置供应商的模型提供能力信息富化、上下文窗口数据和新模型发现功能。

### 架构分层

模型注册表跨越 `shared` 和 `renderer` 两个层：

| 层 | 路径 | 职责 |
|------|------|------|
| shared | `src/shared/model-registry/` | 供应商 ID 映射、数据转换、模型匹配与富化 |
| renderer | `src/renderer/packages/model-registry/` | 网络请求、多级缓存、React 订阅、向后兼容 API |

### 供应商 ID 映射

`src/shared/model-registry/provider-mapping.ts` 维护 Chatbox 供应商 ID 到 models.dev 供应商 ID 的映射关系：

- 支持多对一映射（如 `openai` 和 `openai-responses` 均映射到 models.dev 的 `openai`）
- 未在映射表中的供应商（Ollama、LM Studio、Azure、ChatboxAI 等）不参与 models.dev 富化
- 映射关系同时被运行时富化和构建时快照生成脚本共用（**单一数据源**）

当前映射覆盖：OpenAI、Claude、Gemini、xAI、DeepSeek、Groq、Mistral、Perplexity、OpenRouter、MiniMax、Moonshot、SiliconFlow、ChatGLM、Qwen 等。

### 数据获取与缓存

`src/renderer/packages/model-registry/fetch.ts` 实现多级缓存策略：

```
查找优先级：内存缓存 → 平台 Blob 存储 → 构建时快照
```

| 数据源 | 来源 | 时效性 |
|------|------|------|
| 内存缓存 | 运行时 fetch 结果 | 当前会话 |
| 平台 Blob 存储 | `platform.getStoreBlob()` | 7 天 TTL |
| 构建时快照 | `snapshot.generated.ts` | 构建时 |

关键 API：

| 函数 | 用途 |
|------|------|
| `getRegistrySync()` | 同步获取（内存缓存 → 构建时快照），无 I/O |
| `getRegistry()` | 异步获取，必要时从 Blob 缓存加载或发起 fetch |
| `prefetchModelRegistry()` | 应用启动时后台预加载 |
| `forceRefreshRegistry()` | 用户点击"获取模型"按钮时强制刷新 |
| `fetchAndUpdateRegistry()` | 从 `https://models.dev/api.json` 获取数据（15s 超时），并发调用自动去重 |

缓存策略要点：
- 并发 fetch 请求通过共享 Promise 去重
- fetch 失败时保留已有缓存数据，不清空
- 数据更新后通过 `setRuntimeRegistry()` 注入 shared 层，使 `enrichModelFromRegistry()` 使用最新数据
- 通过 `subscribeRegistry()` + `useSyncExternalStore` 通知 React 组件刷新

### 模型匹配算法

`src/shared/model-registry/enrich.ts` 中的 `findModelInRegistry()` 实现两级匹配：

1. **精确匹配**（大小写不敏感）
2. **边界感知前缀匹配**——取最长匹配的注册表 key，要求 key 之后的字符必须是边界字符（`-`、`:`、`.`）或字符串结束

例如：`gpt-4o:ft-xxx` 能匹配 `gpt-4o`，但 `gpt-4` 不能匹配 `gpt-4o`（`o` 不是边界字符）。

### 模型富化（Enrichment）

`enrichModelFromRegistry()` 的富化策略：

| 字段 | 策略 | 原因 |
|------|------|------|
| `capabilities` | registry **覆写** | 事实数据，registry 更权威 |
| `contextWindow` | registry **覆写** | 事实数据，registry 更权威 |
| `maxOutput` | registry **覆写** | 事实数据，registry 更权威 |
| `nickname` | 仅在缺失时填充 | 用户可能已自定义 |
| `type` | 仅在缺失时填充 | 保留现有分类 |

### 模型列表合并流程

`src/renderer/packages/model-setting-utils/base-config.ts` 中的 `getBaseModelConfigs()` 实现四源合并：

```
1. 本地策展模型（provider definition 的 curatedModelIds）
2. 后端远程模型（provider 自定义 API）
3. Provider API 模型（listProviderModels()）
4. models.dev 注册表（仅当 provider API 返回空时作为 fallback）
         ↓
   mergeOptionGroups()（本地优先级最高）
         ↓
   enrichModelsFromRegistry()（registry 元数据叠加）
         ↓
   getDiscoveredModels()（追加近期发布的新模型，仅在 provider API 成功时）
```

关键决策：
- 本地模型配置优先于远程配置（保留用户自定义）
- 注册表富化**覆写** capabilities/contextWindow（更权威）
- **仅在 provider API 成功时**才追加发现的新模型（避免在 fallback 模式下引入未经验证的模型）

### 新模型发现

`getDiscoveredModels()` 从 registry 中筛选出不在 curated 列表且不在现有列表中的模型，按 `release_date` 过滤近 6 个月内发布的模型，在 UI 中以"New"标签展示。

### 契约测试

模型注册表系统通过以下测试锁定不变量：

| 测试文件 | 验证内容 |
|---------|---------|
| `src/shared/providers/index.contract.test.ts` | 供应商 ID 全局唯一、models.dev 映射一致性、策展模型覆盖率 |
| `src/renderer/packages/model-registry/index.test.ts` | 按供应商隔离的模型查找、前缀匹配行为 |
| `src/renderer/packages/model-registry/fetch.test.ts` | fetch 失败回退、内存缓存保留、并发请求去重 |

### 文件索引

| 文件 | 用途 |
|------|------|
| `src/shared/model-registry/provider-mapping.ts` | Chatbox ↔ models.dev 供应商 ID 映射（单一数据源） |
| `src/shared/model-registry/enrich.ts` | 模型匹配与富化（shared 层） |
| `src/shared/model-registry/transform.ts` | models.dev API 响应 → 内部格式转换 |
| `src/shared/model-registry/types.ts` | `ModelMetadata`、`ModelRegistryData` 等类型定义 |
| `src/shared/model-registry/snapshot.generated.ts` | 构建时快照（自动生成，勿手动编辑） |
| `src/renderer/packages/model-registry/fetch.ts` | 网络请求、多级缓存、订阅机制 |
| `src/renderer/packages/model-registry/enrich.ts` | 列表级富化、fallback 模型列表、新模型发现 |
| `src/renderer/packages/model-registry/index.ts` | 公开 API 与向后兼容层 |

## OAuth 认证集成

Provider 系统除了处理 API Key，也承载了桌面端 OAuth 登录能力。整体实现横跨 `main`、`renderer` 和 `shared` 三层：

- `src/main/oauth/`：主进程 OAuth provider 注册表、IPC handler、回调监听与 token 刷新
- `src/renderer/hooks/useOAuth.ts`：设置页登录、切换认证模式、自动刷新 token
- `src/shared/oauth/`：共享的 provider mapping、credential manager、OAuth fetch 封装
- `src/shared/providers/definitions/*.ts`：在具体 provider 的 `createModel()` 中决定是否启用 OAuth 请求链路

### 支持的 OAuth Provider

| Chatbox Provider | OAuth Provider ID | Flow 类型 | 关键实现 |
|------|------|------|------|
| `openai` | `openai` | callback | `src/main/oauth/providers/openai.ts` |
| `openai-responses` | `openai` | callback | 复用 OpenAI OAuth provider |
| `claude` | `claude` | code-paste | `src/main/oauth/providers/anthropic.ts` |
| `github-copilot` | `github-copilot` | device-code | `src/main/oauth/providers/github-copilot.ts` |

### 三种 OAuth 流程

主进程通过 `src/main/oauth/index.ts` 暴露统一 IPC 接口，但不同供应商走不同的授权模式：

1. **Callback flow**
   OpenAI 使用本地 callback server。主进程启动临时 HTTP 监听器，打开浏览器授权，收到 `code` 后在本地完成 token exchange。
2. **Code-paste flow**
   Anthropic 返回授权页后，用户需要把回调地址或授权码粘贴回应用，再由主进程调用 token endpoint。
3. **Device-code flow**
   GitHub Copilot 返回 `user_code` 和 `verification_uri`，用户在浏览器输入验证码，主进程轮询拿 token。

### Provider 设置与共享凭证

`src/shared/oauth/provider-mapping.ts` 定义了 Chatbox provider 和 OAuth provider 的映射关系。当前只有一组共享关系：

- `openai-responses -> openai`

其语义分成两层：

- **OAuth 凭证共享**
  `openai-responses` 复用 `openai` 存储的 `oauth` token，避免用户重复登录。
- **认证模式独立**
  `activeAuthMode` 保留在各自 provider 设置中，`openai` 与 `openai-responses` 可以分别选择当前走 API Key 还是 OAuth。

这是通过 `mergeSharedOAuthProviderSettings()` 实现的：它只合并共享凭证，不覆盖当前 provider 的 `activeAuthMode`。对应回归测试见 `src/shared/oauth/provider-mapping.test.ts`。

### 运行时调用链

当某个 provider 开启 OAuth 后，模型创建和请求发送会额外经过 OAuth 适配层：

1. `getProviderSettings()` 先合并 provider 设置与共享 OAuth 凭证
2. `resolveEffectiveApiKey()` 根据 `activeAuthMode` 和平台决定取 OAuth token 还是 API Key
3. `createOAuthCredentialManager()` 负责缓存 token、按需刷新、把新 token 回写到设置
4. provider-specific fetch wrapper 注入鉴权头

当前主要有三类封装：

- `createOpenAIOAuthFetch()`：OpenAI / OpenAI Responses 使用，兼容代理请求重写
- `createBearerOAuthFetch()`：Anthropic 等直接注入 Bearer token
- `createCopilotOAuthFetch()`：GitHub Copilot 专用头与 endpoint 适配

### 关键实现约束

- **桌面端限定**
  OAuth IPC、callback server 和 token refresh 只在 desktop 平台启用；web / mobile 仍以 API Key 为主。
- **OpenAI callback host**
  OpenAI 的 `redirect_uri` 必须和本地 callback server 监听 host 一致。当前实现统一使用 `localhost`，否则授权页可能直接报错。
- **Anthropic 非标准 state 约束**
  Anthropic 的授权页不接受“独立随机 state + PKCE verifier”的标准拆分实现。当前必须让 `state` 复用 verifier，否则浏览器授权页会返回 `Authorization failed / Invalid request format`。该约束已在 `src/main/oauth/providers/anthropic.ts` 写明注释，并由 `src/main/oauth/providers/anthropic.test.ts` 锁定。
- **共享 token 的写回行为**
  OAuth token refresh 和 clear 操作只更新共享凭证存储，不会联动修改其他 provider 的 `activeAuthMode`，避免 OpenAI 与 OpenAI Responses 的认证模式互相覆盖。

## 模型类层级

### 基类体系

模型类位于 `src/shared/providers/definitions/models/`，遵循以下继承结构：

- **`AbstractAISDKModel`**：抽象基类，定义核心接口（`streamText()`、`callChatCompletion()`）。Claude、Gemini 等使用独立 SDK 的供应商直接继承此类。
- **`OpenAICompatible`**：继承自 `AbstractAISDKModel`，封装 OpenAI 兼容 API 的通用逻辑。大多数供应商（Groq、DeepSeek、SiliconFlow、Ollama 等）继承此类。

### 能力声明系统

模型通过 `capabilities` 数组和方法声明其支持的能力：

| 能力 | 对应方法 | 说明 |
|------|---------|------|
| `vision` | `isSupportVision()` | 支持图片输入 |
| `tool_use` | `isSupportToolUse()` | 支持函数/工具调用 |
| `reasoning` | `isSupportReasoning()` | 推理模型（如 o1、o3 系列） |

能力信息在 `defaultSettings.models[].capabilities` 中静态声明，也可在模型类中动态覆盖。此系统用于 UI 条件渲染（如仅对支持视觉的模型显示图片上传按钮）和运行时行为适配。

### 当前内置供应商

系统内置 16 个供应商定义（通过副作用导入注册），加上用户自建供应商，总共支持 30+ 家服务商。内置供应商涵盖：

- **云端大厂**：OpenAI、Claude（Anthropic）、Gemini（Google）、Azure OpenAI
- **专业服务**：DeepSeek、Groq、xAI、Mistral AI、Perplexity
- **国内平台**：SiliconFlow（硅基流动）、VolcEngine（火山引擎）、ChatGLM（智谱）
- **聚合平台**：OpenRouter
- **本地推理**：Ollama、LM Studio
- **自有服务**：ChatboxAI

## 自建供应商

用户可在设置中添加自建供应商。自建供应商不经过 `defineProvider()` 注册，而是在 `getModel()` 中通过 `createCustomProviderModel()`（`src/shared/providers/utils.ts`）动态创建。

该函数根据用户选择的 `ModelProviderType` 分发到对应的 Custom 模型类：

| 协议类型 | 模型类 |
|---------|--------|
| `Claude` | `CustomClaude` |
| `Gemini` | `CustomGemini` |
| `OpenAIResponses` | `CustomOpenAIResponses` |
| `OpenAI`（默认） | `CustomOpenAI` |

这使得用户可以对接任何兼容上述协议的第三方 API，无需修改代码。

### 自建供应商 ID 约束

- 自建 provider 的 `id` 必须是全局唯一字符串
- 自建 provider 的 `id` 不允许与任意内置 provider ID 相同
- 若导入配置声明 `isCustom: true` 且与 builtin 冲突，系统会直接拒绝该配置

原因是：provider ID 同时用于设置存储、运行时 provider 路由、OAuth 共享映射和设置页导航。若允许 builtin/custom 共用 ID，会出现“展示的是一个 provider，实际请求走的是另一个 provider”的控制面歧义

## 架构演进

供应商系统经历了一次重大重构：

### 旧方案（手动注册）

记录于 [`docs/adding-provider.md`](../adding-provider.md)。添加一个新供应商需要修改 **7-8 个文件**：

1. `types.ts` — 添加枚举值
2. `models/your-provider.ts` — 创建模型实现
3. `models/index.ts` — 在 `getModel()` switch 中添加 case
4. `defaults.ts` — 在 `SystemProviders` 数组中添加配置
5. `model-setting-utils/` — 创建并注册设置工具类
6. UI 图标文件

信息**高度分散**：供应商的 ID、名称、默认配置、工厂逻辑、显示名称分布在不同文件和 switch 语句中，新增或修改供应商极易遗漏步骤。

### 新方案（注册表模式）

记录于 [`docs/adding-new-provider.md`](../adding-new-provider.md)。添加一个新供应商只需 **4 个文件改动**：

1. `types.ts` — 添加枚举值
2. `definitions/models/your-provider.ts` — 创建模型类
3. `definitions/your-provider.ts` — 一次 `defineProvider()` 调用包含全部信息
4. `providers/index.ts` — 添加一行副作用导入

核心改进：**`defineProvider()` 成为供应商信息的唯一数据源**，消除了 switch 语句和分散配置。迁移对照表见 `docs/adding-new-provider.md` 的 "Migration Notes" 一节。

## 添加新供应商

本文档不重复具体步骤。详细的分步指南请参阅：

- **[`docs/adding-new-provider.md`](../adding-new-provider.md)**（当前推荐，注册表架构）
- `docs/adding-provider.md`（旧版参考，已不推荐使用）
