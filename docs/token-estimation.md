# Token Estimation System

Token 预估系统用于异步计算聊天消息和附件的 token 数量，在不阻塞 UI 的情况下提供实时的 token 统计。

## 架构概览

```text
┌─────────────────────────────────────────────────────────────────────┐
│  React UI (InputBox, TokenCountMenu)                                │
│    └── useTokenEstimation hook                                      │
│           ├── 返回: { totalTokens, isCalculating, breakdown }       │
│           └── 订阅 computationQueue 状态变化                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  analyzer.ts                                                        │
│    ├── 检查消息的 tokenCountMap 缓存                                 │
│    ├── 已缓存 → 直接返回 token 数                                    │
│    └── 未缓存 → 生成 pendingTasks                                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  computation-queue.ts (Singleton)                                   │
│    ├── 优先级队列 (priority: 0=当前输入, 10+=历史消息)               │
│    ├── 任务去重 (by taskId)                                         │
│    ├── 并发控制 (maxConcurrency=1)                                  │
│    └── Session 级别取消                                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  task-executor.ts                                                   │
│    ├── 读取消息/附件内容                                             │
│    ├── 调用 tokenizer 计算 token                                    │
│    └── 将结果发送到 resultPersister                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  result-persister.ts                                                │
│    ├── 累积计算结果                                                  │
│    ├── Throttle 机制 (1000ms) - 保证每秒至少 flush 一次             │
│    └── 调用 chatStore.updateMessages() 持久化                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  chatStore.ts                                                       │
│    ├── 更新 storage (IndexedDB)                                     │
│    └── setQueryData() 更新 React Query 缓存 → UI 重新渲染           │
└─────────────────────────────────────────────────────────────────────┘
```

## 文件结构

```text
src/renderer/packages/token-estimation/
├── index.ts                 # 公共 API 导出
├── types.ts                 # 类型定义 (ComputationTask, TaskResult, etc.)
├── hooks/
│   └── useTokenEstimation.ts  # React Hook - UI 入口
├── analyzer.ts              # 分析哪些消息需要计算
├── computation-queue.ts     # 任务队列管理
├── task-executor.ts         # 任务执行逻辑
├── result-persister.ts      # 结果持久化 (throttle)
├── tokenizer.ts             # Token 计算逻辑 (tiktoken/deepseek)
├── cache-keys.ts            # 缓存 key 生成工具
├── exact-retry.ts           # Worker 回退后的有界精算重试预算（每次运行）
├── draft-tokenization.ts    # 长草稿判定 + 采样快速估算 + 草稿投影 (getDraftTokenizationText) + 文本 digest + 发送种子 (seedExactDraftTokens)
├── draft-tokenizer-worker-client.ts  # 持久 Worker 客户端（单飞 + 优先级队列，交互请求抢占低优先级 encode，abort 即出队；出错/超时后重建）
├── draft-tokenizer-worker-handler.ts # Worker 侧计算逻辑
├── draft-tokenizer.worker.ts # Worker 入口
└── __tests__/               # 单元测试
```

## 核心组件

### 1. useTokenEstimation Hook

**位置**: `hooks/useTokenEstimation.ts`

React 组件的入口点，负责：
- 调用 `analyzeCurrentInputTokens()` / `analyzeContextTokens()` 分析需要计算的任务
- 将任务入队到 `computationQueue`
- 订阅队列状态变化，返回 `isCalculating`
- 当 session 切换时取消旧 session 的任务
- 长草稿（≥4096 字符）的文本计数交给持久 Web Worker 异步精确计算，等待期间显示采样估算；`isCurrentInputApproximate` / `isTotalApproximate` 标记数值是否仍为近似（含 Worker 失败后保留估算的情况）
- 精确结果通过 `exactDraftTokens` 暴露；提交时 InputBox 用 `seedExactDraftTokens()` 把它种到出站消息的 `tokenCountMap` 上（内部比对草稿投影，编辑过的草稿不种），发送路径 (`estimateTokensFromMessages`) 读到该值即跳过主线程全量重编码
- 未种入的长文本（debounce 未到就提交、Worker 失败、精确结果后又编辑）在发送路径同样不做全量编码：`estimateMessageTextTokens` 对 ≥4096 字符且无携带条目的文本退化为采样估算，之后由计算队列经 Worker 补上精确值
- `tokenCountMap` 条目必须描述消息当前文本：编辑路径（modifyMessage / persistStreamingMessage / 保存重发 / `updateQueuedMessageText`）先清除条目（含 `tokenCountApproximate`）再重新估算；异步结果落盘时还会按源文本 digest 校验（见 Result Persister）
- 持久化的采样回退条目带 `tokenCountApproximate` 标记：上下文/总计通过 `isContextApproximate` / `isTotalApproximate` 继续显示 `~`，analyzer 在每次运行的有界重试预算内（`exact-retry.ts`）重新入队精算，预算耗尽后保留标记、下次启动再试

一次性入口 `analyzeTokenRequirements()` 不含 Worker 流程：对长草稿默认退化为采样估算（近似值），调用方可通过 `currentInputTextTokens` 传入已知的精确/最新计数。

```typescript
const {
  totalTokens,      // 总 token 数
  contextTokens,    // 上下文消息 token 数
  currentInputTokens, // 当前输入 token 数
  isCalculating,    // 是否正在计算
  pendingTasks,     // 待处理任务数
  breakdown,        // 详细分解
} = useTokenEstimation({
  sessionId,
  constructedMessage,  // 当前输入（未发送）
  contextMessages,     // 历史消息
  model,
  modelSupportToolUseForFile,
})
```

### 2. Analyzer

**位置**: `analyzer.ts`

分析消息列表，确定哪些需要计算：
- 检查每条消息的 `tokenCountMap` 缓存
- 已缓存 → 直接累加到结果
- 未缓存 → 生成 `ComputationTask`

### 3. Computation Queue

**位置**: `computation-queue.ts`

优先级任务队列，特性：
- **优先级调度**: 当前输入 (0) > 附件 (1) > 历史消息 (10+)
- **去重**: 通过 taskId 防止重复计算
- **并发控制**: 最多 1 个任务同时执行
- **Session 取消**: 切换会话时取消旧会话的任务

```typescript
// 优先级常量
PRIORITY = {
  CURRENT_INPUT_TEXT: 0,      // 最高优先级
  CURRENT_INPUT_ATTACHMENT: 1,
  CONTEXT_TEXT: 10,           // 历史消息基础优先级
  CONTEXT_ATTACHMENT: 11,
}
```

### 4. Task Executor

**位置**: `task-executor.ts`

执行具体的 token 计算：
- 读取消息文本或附件内容
- 调用 tokenizer 计算 token 数；≥4096 字符的消息文本交给草稿 Worker（低优先级，交互式草稿请求会抢占正在执行的低优先级 encode）精算，Worker 不可用/失败/超时则返回标记为近似的采样估算，避免在渲染线程全量编码
- message-text 结果携带源文本投影的 digest 与 `approximate` 标记，并在 `exact-retry.ts` 记录/清除 Worker 回退次数
- 将结果发送到 `resultPersister`

### 5. Result Persister

**位置**: `result-persister.ts`

批量持久化计算结果，使用 **throttle** 机制：

```typescript
// Throttle 而非 Debounce
// - Debounce: 每次调用重置计时器，可能导致长时间不 flush
// - Throttle: 保证每 1000ms 至少 flush 一次

private throttleMs = 1000
private lastFlushTime = 0

private scheduleFlush(): void {
  const now = Date.now()
  const timeSinceLastFlush = now - this.lastFlushTime

  if (timeSinceLastFlush >= this.throttleMs) {
    // 距离上次 flush 已超过 1s，立即 flush
    this.doFlush()
  } else if (!this.flushTimer) {
    // 安排在剩余时间后 flush
    this.flushTimer = setTimeout(() => {
      this.doFlush()
    }, this.throttleMs - timeSinceLastFlush)
  }
  // 如果已有计时器，不做任何事（throttle 行为）
}
```

**为什么用 Throttle？**
- 计算 100 条消息时，任务会连续完成
- Debounce 会不断重置计时器，直到所有任务完成才 flush
- Throttle 保证用户每秒都能看到中间进度

**落盘时的 digest 校验**：message-text 结果从 encode 到 flush 之间隔着 Worker 等待与 throttle 窗口，期间消息可能被编辑（编辑路径先清空计数）。apply 时用消息当前投影的 digest 与结果携带的源 digest 比对，不一致的条目直接丢弃——缓存保持缺失，analyzer 会为新文本重新入队；`approximate` 标记也只随通过校验的条目写入/清除。

### 6. Tokenizer

**位置**: `tokenizer.ts`

实际的 token 计算逻辑，支持：
- **Tiktoken**: OpenAI 模型 (cl100k_base, o200k_base)
- **DeepSeek**: DeepSeek 模型专用 tokenizer

## 缓存机制

Token 计算结果缓存在消息对象的 `tokenCountMap` 字段：

```typescript
interface Message {
  // ...
  tokenCountMap?: {
    tiktoken?: number           // 文本 token (tiktoken)
    tiktoken_preview?: number   // 预览模式 token
    deepseek?: number           // 文本 token (deepseek)
    deepseek_preview?: number   // 预览模式 token
  }
  tokenCalculatedAt?: {
    tiktoken?: number           // 计算时间戳
    // ...
  }
}
```

附件也有类似的缓存结构：

```typescript
interface MessageFile {
  // ...
  tokenCountMap?: TokenCountMap
  tokenCalculatedAt?: Record<string, number>
  lineCount?: number
  byteLength?: number
}
```

## React Query 集成

系统通过 `chatStore` 与 React Query 集成：

```typescript
// result-persister.ts
await chatStore.updateMessages(sessionId, (messages) => {
  return messages.map((msg) => {
    const update = sessionUpdates.find((u) => u.messageId === msg.id)
    if (!update) return msg
    return applyUpdates(msg, update.updates)
  })
})

// chatStore.ts - updateMessages 内部
queryClient.setQueryData(QueryKeys.ChatSession(sessionId), updated)
// ↑ 直接更新缓存，触发 UI 重新渲染
// 不使用 invalidateQueries，避免不必要的重新获取
```

## 初始化

系统在应用启动时初始化：

```typescript
// src/renderer/setup/token_estimation_init.ts
import { initializeExecutor, setResultPersister } from '@/packages/token-estimation/task-executor'
import { resultPersister } from '@/packages/token-estimation/result-persister'
import { computationQueue } from '@/packages/token-estimation/computation-queue'

// 连接 persister 到 executor
setResultPersister(resultPersister)

// 初始化 executor (连接到 queue)
initializeExecutor()

// 启动定期清理
computationQueue.startCleanup()
```

## 调试工具

开发环境下可通过 `window.__tokenEstimation` 访问：

```javascript
// 查看队列状态
window.__tokenEstimation.getStatus()
// { pending: 0, running: 0 }

// 查看待处理任务
window.__tokenEstimation.getPendingTasks()

// 手动触发 flush
window.__tokenEstimation.flushNow()
```

## 性能考虑

1. **并发限制**: 最多 1 个任务同时执行，防止 CPU 过载
2. **优先级调度**: 当前输入优先计算，用户体验更好
3. **Throttle 持久化**: 每秒最多写入一次，减少 I/O
4. **去重**: 相同任务不会重复计算
5. **Session 取消**: 切换会话时取消旧任务，节省资源
6. **内存清理**: 定期清理已完成任务 ID，防止内存泄漏

## 常见问题

### Q: 为什么 token 数显示为 0？
检查：
1. `initializeExecutor()` 是否被调用
2. `setResultPersister()` 是否被调用
3. 控制台是否有错误日志

### Q: 为什么计算很慢？
可能原因：
1. 大量历史消息需要计算
2. 附件文件较大
3. 可以通过 `window.__tokenEstimation.getStatus()` 查看队列状态

### Q: 如何添加新的 tokenizer？
1. 在 `tokenizer.ts` 添加新的计算逻辑
2. 在 `types.ts` 更新 `TokenizerType` 类型
3. 在 `cache-keys.ts` 更新缓存 key 生成逻辑

### Q: 切换 session 后 isCalculating 状态不正确？

**问题**（已修复）：切换 session 后，InputBox 和 TokenCountMenu 仍显示上一个 session 的计算状态。

**原因**：
1. `InputBox` 使用 `key` 导致组件重新挂载，原有的 `prevSessionIdRef` 取消逻辑失效
2. `computationQueue.getStatus()` 返回全局队列状态，而非当前 session 的状态

**解决方案**：
1. 使用 effect cleanup function 在组件卸载时取消任务（替代 `useRef` 方案）
2. 添加 `getStatusForSession(sessionId)` 方法返回指定 session 的状态
3. `useTokenEstimation` hook 订阅当前 session 的状态变化

**相关代码**：
- `computation-queue.ts`: `getStatusForSession()`
- `useTokenEstimation.ts`: cleanup function + session-scoped status
