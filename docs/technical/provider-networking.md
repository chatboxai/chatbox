# Provider 网络兼容性请求

> Last updated: 2026-08

## 目标与术语

Provider 设置中的“改善网络兼容性”持久化字段仍名为 `useProxy`，以兼容已有用户数据。这个字段表达的是**启用宿主的兼容性请求路径**，不保证实际经过 Chatbox relay：Desktop 使用主进程直连，Mobile 使用原生网络，只有 Web 和 HarmonyOS 的非本地地址使用 Chatbox relay。

通用设置中的“网络代理”是另一项能力：它通过 `session.defaultSession.setProxy()` 配置 Electron session。Desktop 主进程直连复用该 session，因此仍遵守用户配置的网络代理；这个代理与 Chatbox relay 是两种不同的请求边界。

## 传输矩阵

| 平台 | `useProxy=false` | `useProxy=true` 且本地地址 | `useProxy=true` 且非本地地址 |
|------|------------------|----------------------------|------------------------------|
| Desktop | Renderer `fetch` | Renderer `fetch` | Electron Main 中默认 session 的 `net.fetch`，请求原始地址 |
| Web | Renderer `fetch` | Renderer `fetch` | Chatbox relay |
| Mobile | WebView `fetch` | Capacitor native transport | Capacitor native transport |
| HarmonyOS | Renderer `fetch` | Renderer `fetch` | Chatbox relay |

本地地址由 `isLocalHost()` 判定，目前包括 `localhost`、loopback、`10.0.0.0/8`、`192.168.0.0/16` 和 `172.16.0.0/12`。此判定在 Web/HarmonyOS 上防止把内网目标地址和凭证发送给 relay；Desktop 开启兼容性请求时按产品约束仅把非本地地址切到主进程。

LM Studio 是移动端例外：Provider definition 在 Mobile 上自动把兼容性偏好设为开启，使局域网请求使用 Capacitor native transport 并触发系统局域网权限；Desktop 仍只遵守用户设置。

## 调用链与所有权

```text
Provider model
  → createFetchWithProxy(useProxy)
  → ModelDependencies.request.apiRequest
  → RendererRequestAdapter
  → renderer/utils/request.ts
      ├─ Desktop remote + enabled → desktop-direct-request IPC → default session net.fetch(original URL)
      ├─ Mobile + enabled         → Capacitor native transport
      ├─ Web/Harmony remote       → Chatbox relay
      └─ otherwise                → Renderer fetch
```

- Renderer 负责按平台、本地地址和兼容性偏好选择请求路径。
- Electron Main 的 `DesktopDirectRequestManager` 拥有默认 session 请求、`AbortController` 和响应流 reader 的生命周期。
- IPC 使用 `start → read* → done/cancel` 的 pull 模式。Renderer 每次只拉取一个 chunk，避免主进程无限推送造成内存堆积；Renderer 取消或销毁时，Main 必须终止对应请求并释放 reader。
- Desktop 主进程只接受 `http:` 和 `https:` 目标。响应状态、状态文本、headers 和 body chunks 原样返回，由 Renderer 重建标准 `Response`。

## CORS、Origin 与 relay

Desktop 主进程请求不经过 renderer 的页面请求上下文，不执行 renderer CORS 校验，也不会附加 renderer `Origin`。请求仍然直达用户配置的原始 API 地址，不能在失败时静默回退到 relay。

`BrowserWindow.webPreferences.webSecurity=false` 是现有 Renderer 的独立设置，不能据此推断上游服务一定接受请求：服务端仍可主动拒绝 renderer 携带的 `Origin`。主进程直连解决的是该请求边界以及 relay 可用性问题。

## 重试、错误和全局代理

- 宿主传输层的 Provider POST 保持 `retry: 0`，不会因切换进程或未知网络错误自动重放。上层 `AbstractAISDKModel` 仍按既有策略重试开始阶段返回的 429/5xx；一旦已输出流式内容则不重试。
- HTTP 非成功状态仍由 Renderer 转换为既有 `ApiError`；取得 `Response` 前的请求 / IPC 失败由请求层转换为 `NetworkError`。响应返回后的 IPC 读取失败通过 `ReadableStream` error 继续交给 Provider / AI SDK 处理，不会重新进入请求层重试。
- AbortSignal 不跨 IPC 序列化。Renderer 发送 request ID，Main 使用自己持有的 `AbortController` 取消 session 请求。
- Desktop 直连使用 Electron 默认 session 的 `net.fetch`，继承 `session.defaultSession.setProxy()` 配置的“网络代理”，但不会经过 Chatbox relay。

## 关键实现

| 文件 | 责任 |
|------|------|
| `src/renderer/utils/request.ts` | 平台和地址路由、既有 retry/error 语义 |
| `src/renderer/utils/desktop-direct-request.ts` | IPC 请求序列化、Response/ReadableStream 重建、Renderer 取消 |
| `src/main/desktop-direct-request.ts` | Main 请求、流 reader、owner 隔离和资源清理 |
| `src/main/main-fetch.ts` | Main 内实际网络实现；Desktop 兼容性请求使用默认 Electron session |
| `src/shared/desktop-direct-request.ts` | IPC wire contract |
| `src/shared/models/utils/fetch-proxy.ts` | 把兼容性偏好传递给宿主 RequestAdapter |

相关确定性测试必须覆盖 Desktop 非本地直连、本地地址不改道、Web relay 保持不变、流式读取、取消、协议限制以及 POST 不重试。
