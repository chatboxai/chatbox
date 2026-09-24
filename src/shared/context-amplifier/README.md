# Context Amplifier（上下文放大系统）

## 概述

Context Amplifier 是一个四层分级压缩 + 按戳召回的上下文管理系统，解决长会话中的两个核心问题：

1. **防止状态丢失**：保留完整的工具调用历史，避免模型重复探索文件
2. **突破上下文限制**：通过分层压缩 + 远古归档，在有限窗口内保留更长的会话历史

## 架构设计

### 四层分级策略

| 层级 | 累计上限 | 压缩强度 | 前端显示 | 说明 |
|------|---------|---------|---------|------|
| **L0** | 最后 2 轮 | 无压缩 | 原样显示 | 当前工作集，完整保留 |
| **L1** | 200K tokens | 合并同类项 | `[L1 合并] #STAMP xxx` | 保留完整问答，工具链合并为箭头表示 |
| **L2** | 384K tokens | 提纯 | `[L2 提纯] #STAMP xxx` | 提问要点+过程描述+结论精简 |
| **L3** | 712K tokens | 摘要 | `[L3 摘要] #STAMP xxx` | 查询入口：主题/涉及文件/结论 |
| **远古区** | 超过 712K tokens | 不压缩 | 不显示 | 完整块归档，不进上下文，仅供召回 |

### 双层召回策略

```
模型发现 #STAMP 标记
  ↓
调用 retrieve_by_stamp 工具
  ↓
第一层：在压缩区搜索（L1/L2/L3）
  ↓ 找到 → 返回压缩后内容
  ↓ 未找到
第二层：在远古区搜索（712K tokens 之外的完整块）
  ↓
返回原始完整内容
```

**设计理念**：先近后远，优先命中压缩区（更接近当前时间，检索更快）。

## 核心文件

### 1. `pipeline.ts` - 主压缩流程

**关键函数**：
- `amplifyContext(messages, options)` - 入口函数，执行完整压缩流程
- `classifyBlocks(blocks)` - 按累计字节数分层（200K/384K/712K 三道线 + L0 固定 2 轮）
- `processBlock(block, layer, store)` - 根据层级选择压缩提示词

**分层逻辑**：
```typescript
累计大小 = 0
从最新消息向前遍历:
  if 轮次 <= 2: → L0（完整保留）
  else if 累计 <= 200K tokens: → L1（合并同类项）
  else if 累计 <= 384K tokens: → L2（提纯）
  else if 累计 <= 712K tokens: → L3（摘要）
  else: → 远古区（归档，不进上下文）
```

**三套压缩提示词**：
- `PROMPT_L1`：保留原有问答结构，工具调用链合并为箭头表示
- `PROMPT_L2`：提取要点、过程、结论，精简到 30-40% 原文
- `PROMPT_L3`：生成查询入口（主题关键词 + 涉及文件 + 核心结论），压缩到 5% 以内

### 2. `singleton.ts` - 配置与单例管理

**关键常量**：
```typescript
L0_COUNT = 2              // L0 保留最后 2 轮
L1_THRESHOLD = 200 * 1024 // 200K tokens
L2_THRESHOLD = 384 * 1024 // 384K tokens
L3_THRESHOLD = 712 * 1024 // 712K tokens
```

**单例**：
- `getSharedStampStore()` - 跨请求复用的 StampStore 实例
- `createCompressBlock()` - GLM-5.2 压缩客户端（可配置 API key）

### 3. `recall-agent.js` - 召回智能体

**关键函数**：
- `recallByStamp(store, input, options)` - 执行双层召回
  - `input.stamp` - 戳标识符
  - `input.question` - 需要什么信息
  - `input.searchScope` - `'compressed'` 或 `'archive'`

**搜索策略**：
1. 根据 `searchScope` 过滤候选块（默认 `'compressed'`）
2. 语义匹配：用 question 与块的摘要计算相似度
3. 返回最匹配的块内容

### 4. `stamp-store.js` - 存储引擎

**核心方法**：
- `add(stamp, originalBlock, summary, metadata)` - 存储压缩块
  - `metadata.layer` - 标记层级（'L1'/'L2'/'L3'/'archive'）
  - `metadata.timestamp` - 时间戳
- `get(stamp)` - 按戳精确查找
- `search(query, filter)` - 语义搜索

## 集成点

### 1. 主集成 - `src/shared/context/builder.ts`

**关键改动**：将 `amplifyContext` 调用提到 `applyCompaction` **之前**

```typescript
// 修改前（旧逻辑）：
let contextMessages = applyCompaction(...)  // 先删除工具调用
if (options.contextAmplifier) {
  contextMessages = await amplifyContext(...)  // 接不到完整工具链
}

// 修改后（新逻辑）：
let contextMessages = completedMessages
if (options.contextAmplifier) {
  contextMessages = await amplifyContext(...)  // 先压缩完整工具链
}
contextMessages = applyCompaction(...)  // 再删除旧轮次（此时已是压缩文本）
```

**原因**：`amplifyContext` 必须在上游的 `applyToolCleanup`（`stub-old-results` 工具清理）之前运行——否则占位 stub 会截断工具链，压缩输入不再无损；压缩完成后再做清理，stub 只作用于仍然保留的原始结果。

## Bounded Projection（有界工具结果投影）

单条工具结果超过 `PROJECTION_TOKEN_LIMIT`（20K tokens）时在 wire 路径做投影：内联保留 70% 头部 + 30% 尾部，全文以工具级内容寻址戳（`sha256(toolCallId:toolName:content[:100])[:12]`）存入 StampStore（layer=PROJECTED），内联标记携带 `#STAMP` 戳，模型沿用既有 `retrieve_by_stamp` 工具即可召回原文。

投影在 `applyToolCleanup` 之后运行，只处理真正上 wire 的结果，且从不改动 session 存储的 canonical 历史（幂等：已含 `[tool-result-projection]` 的结果跳过）。

### 2. 工具注册 - `src/renderer/stores/session/tools-builder.ts`

**新增工具**：`retrieve_by_stamp`

```typescript
tools.retrieve_by_stamp = buildRetrieveByStampTool()
```

**工具描述**：
- 输入：`stamp`（戳标识符）、`question`（需要什么信息）、`searchScope`（可选，默认 `'compressed'`）
- 输出：召回的原始内容或错误信息
- 策略：先查压缩区，找不到才查远古区

## 使用指南

### 启用上下文放大

在构建上下文时传入 `contextAmplifier` 选项：

```typescript
const contextMessages = await buildContext(messages, {
  contextAmplifier: {
    enabled: true,
    store: getSharedStampStore(),
    l0Count: 2,
    l1Threshold: 200 * 1024,
    l2Threshold: 384 * 1024,
    l3Threshold: 712 * 1024,
  },
  // ... 其他选项
})
```

### 前端显示

压缩后的消息带 `isSummary: true` 标志，内容格式：

```
[L1 合并] 以下内容已压缩，可通过 #STAMP a1b2c3d4e5f6 精确召回完整原文。

<summary>
用户：如何实现 X 功能？
助手：需要修改 A.ts 和 B.ts → Read(A.ts) → Edit(A.ts) → 完成
</summary>
```

**前端建议**：
1. 用不同颜色区分层级（L1/L2/L3/ARCHIVE）
2. `#STAMP` 标记可点击，触发召回
3. 远古区消息不显示（它们不在 `contextMessages` 里）

### 召回使用

模型看到 `#STAMP` 标记时，会自动调用 `retrieve_by_stamp` 工具：

```typescript
// 模型自动生成的工具调用
{
  tool: 'retrieve_by_stamp',
  args: {
    stamp: 'a1b2c3d4e5f6',
    question: '当时修改了 A.ts 的哪些部分？',
    searchScope: 'compressed'  // 先查压缩区
  }
}
```

如果压缩区找不到，模型会重试 `searchScope: 'archive'`。

## 测试

### 运行集成测试

```bash
cd src/shared/context-amplifier
node test-integration.js
```

**测试内容**：
1. 生成约 800KB 的模拟会话
2. 验证分层是否按 200K/384K/712K 切分
3. 检查 StampStore 存储是否正确
4. 测试召回功能

### 预期输出

```
=== 集成测试开始 ===

生成 12 条消息，总大小约 980KB

=== 压缩结果 ===
输出消息数: 8

压缩消息数: 5
  1. [L3 摘要] - 戳: abc123
  2. [L2 提纯] - 戳: def456
  3. [L1 合并] - 戳: ghi789
  4. [L1 合并] - 戳: jkl012
  （L0 原样，无压缩标记）

StampStore 中存储的块数: 6  // 5 个压缩块 + 1 个远古区块

=== 测试召回 ===
尝试召回戳: abc123
召回成功: 是
召回来源: compressed
召回内容长度: 15234 字符

=== 集成测试完成 ===
```

## 性能考量

### Token 开销

| 操作 | 开销 | 说明 |
|------|------|------|
| L1 压缩 | ~原文的 58% | 保留结构，只合并工具链 |
| L2 压缩 | ~原文的 27% | 提纯精简 |
| L3 压缩 | ~原文的 0.5% | 只保留查询入口 |
| 远古归档 | 0 | 不压缩，不进上下文 |
| 召回调用 | ~500 tokens/次 | 仅在需要时触发 |

### 延迟

- **首次压缩**：需要调用 GLM-5.2 API，约 1-3 秒/块
- **增量压缩**：只压缩新降级的块，已压缩块走缓存
- **召回**：本地语义搜索，< 100ms

### 内存占用

- **StampStore**：单例跨请求复用，长会话可能占用数十 MB
- **远古区**：完整块存内存，超长会话（数百轮）可能需要落盘优化

## 故障排除

### 问题 1：压缩后仍然重复探索文件

**可能原因**：`amplifyContext` 在 `cleanToolCalls` 之后执行，接不到完整工具链。

**解决**：检查 `builder.ts` 中 `amplifyContext` 的调用位置，必须在 `applyCompaction` 之前。

### 问题 2：召回找不到内容

**可能原因**：
1. 戳标识符错误（大小写敏感）
2. `searchScope` 设置不对（压缩区找远古块，或反之）
3. StampStore 未正确存储

**排查**：
```javascript
const store = getSharedStampStore()
console.log('Store size:', store.size())
console.log('All stamps:', store.list().map(item => item.stamp))
```

### 问题 3：压缩层级不符合预期

**可能原因**：字节数计算有误，或阈值配置错误。

**排查**：在 `pipeline.ts` 的 `classifyBlocks` 中添加日志：
```typescript
console.log(`Block ${i}: accum=${accumulated}, layer=${layer}`)
```

## 配置项

所有配置在 `singleton.ts` 中，可通过环境变量或配置文件覆盖：

```typescript
export const CONFIG = {
  L0_COUNT: parseInt(process.env.CTX_AMP_L0_COUNT || '2'),
  L1_THRESHOLD: parseInt(process.env.CTX_AMP_L1_KB || '200') * 1024,
  L2_THRESHOLD: parseInt(process.env.CTX_AMP_L2_KB || '384') * 1024,
  L3_THRESHOLD: parseInt(process.env.CTX_AMP_L3_KB || '712') * 1024,
  COMPRESS_MODEL: process.env.CTX_AMP_MODEL || 'glm-5-2',
  COMPRESS_API_KEY: process.env.CTX_AMP_API_KEY,
}
```

## 未来优化方向

1. **远古区落盘**：超长会话时，将远古区块写入 `~/.chatbox/context-archive/<sessionId>.jsonl`
2. **压缩缓存持久化**：StampStore 序列化到磁盘，进程重启后恢复
3. **自适应阈值**：根据模型窗口大小动态调整 L1/L2/L3 边界
4. **分布式压缩**：并行调用多个压缩 API，加速首次压缩

## 许可

与 Chatbox 项目保持一致。
