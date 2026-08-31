# Chatbox Pro 测试策略

> Last updated: 2026-08

本页说明测试分层和使用方式。可执行命令以根 [`package.json`](../package.json) 为准，CI 门禁以 [`.github/workflows/`](../.github/workflows/) 为准。

## 测试分层

| 层级 | 位置 | 目的 |
|------|------|------|
| 单元与模块测试 | 与源码同目录的 `*.test.ts(x)` / `*.spec.ts(x)` | 验证纯逻辑、组件和模块契约 |
| Package 测试 | `packages/*/src/**` | 验证共享 Core、React bindings 等公共边界 |
| 集成测试 | `test/integration/` | 验证跨模块数据流、持久化、Provider 或完整生成管线 |
| Electron E2E | `test/e2e/` | 在 Electron 应用中验证真实导航和用户流程 |
| 性能测试 | `test/performance/`、`scripts/performance/` | 记录关键路径的性能基线和趋势 |
| React Native smoke | `test/react-native-smoke/` | 验证 Metro、Hermes、共享入口和原生宿主契约 |
| 模型评测 | `scripts/session-rag-eval/` 等 | 验证模型或工具调用行为；与确定性测试分开运行 |

普通模块级测试应遵循所在模块的既有目录约定。顶层 `test/` 只用于集成、E2E 和跨模块场景。

## 常用命令

| 命令 | 用途 | 外部依赖 |
|------|------|----------|
| `pnpm test:unit` | 默认单元测试集合；排除 integration、migration 和部分重型测试 | Vitest 启动时读取当前 checkout 的 `.env` |
| `pnpm test:integration` | 运行 `test/integration/` | Vitest 启动时读取 `.env`；部分 suite 还需要环境或服务 |
| `pnpm test:chat-e2e` | 使用 fake model 和内存存储验证聊天生成管线 | Vitest 启动时读取当前 checkout 的 `.env` |
| `pnpm test:e2e` | 运行 Electron Playwright 测试 | 需要预先构建应用和 Electron 运行环境 |
| `pnpm test:model-provider` | 显式运行真实 Provider API 测试 | 需要密钥和网络 |
| `pnpm test:chat-e2e:live` | 显式运行真实聊天模型流程 | 需要密钥和网络 |
| `pnpm check:shared-boundaries` | 架构边界检查及其测试 | 无 |
| `pnpm check:docs` | 根指令、知识入口、计划索引和 Markdown 链接检查 | 无 |

不要把 live suite 混入普通单元测试。真实 API 测试必须由专用环境变量显式启用，避免意外读取凭据或产生费用。

除 Chatbox API 专用运行路径外，根 Vitest 配置会在启动时同步加载当前 checkout 的 `.env`。主仓库 `.env` 可能是由 1Password 提供的 FIFO；在主 checkout 运行这些命令前，需要确保 1Password writer 正在服务，否则启动可能阻塞。需要显式读取主仓库环境文件的集成测试必须遵循 [`AGENTS.md`](../AGENTS.md) 中的有界探测规则，不得直接读取、覆盖或修复该路径。

## Vitest 配置

根 [`vitest.config.ts`](../vitest.config.ts) 默认收集：

- `src/**/*.{test,spec}.{ts,tsx}`；
- `packages/**/*.{test,spec}.{ts,tsx}`；
- `scripts/harmony/**/*.{test,spec}.ts`；
- `test/integration/**/*.{test,spec}.{ts,tsx}`。

默认排除依赖、构建产物、release 目录，以及需要显式 opt-in 的 live Provider/Chatbox API suites。`test:unit` 会在此基础上进一步排除 integration 和重型场景。

## CI 当前覆盖

默认 CI 会运行：

- repository knowledge 与架构边界检查；
- Biome lint/format 报告；
- TypeScript type check；
- 三个 shard 的 `test:unit`。

Electron E2E 当前通过 `ci:e2e` label 或 workflow dispatch 触发。平台、发布和 live-provider 验证由各自 workflow 或发布流程负责；不要在 PR 描述中声称运行了未实际执行的检查。

## 测试设计原则

1. 优先使用 deterministic fake、in-memory repository 和固定 fixture，确保失败可复现。
2. 测试用户可观察的行为和公共契约，避免绑定内部调用顺序。
3. 涉及持久化时覆盖缺失、旧数据、损坏数据、导入/备份和重启边界。
4. 涉及多平台时明确覆盖 Desktop、Web、Mobile、Test 中受影响的路径，不用一种宿主结果替代另一种。
5. 涉及模型或网络时，将协议转换测试、确定性集成测试和 live eval 分层。
6. 修复回归时先保留最小失败用例，再验证修复和相邻边界。

## Provider mock 示例

Provider 协议测试可使用 `@ai-sdk/provider-utils/test` 的 `createTestServer`：

```typescript
const server = createTestServer({
  'https://api.openai.com/v1/chat/completions': {
    headers: { 'Content-Type': 'text/event-stream' },
    chunks: ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', 'data: [DONE]\n\n'],
  },
})
```

多轮响应使用 handler 的 `callNumber`，不要让单元测试请求真实服务。

## 维护要求

- 增删测试命令或改变 CI 覆盖时，同步更新本页。
- 新增需要凭据、设备或长时间运行的 suite 时，提供显式 opt-in、超时和清晰失败分类。
- 计划或技术文档中的验证结果只记录实际执行的命令、SHA、平台和必要证据。
