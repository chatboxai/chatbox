# Gemini 工具调用 Thought Signatures

> Last updated: 2026-07

本文记录 Gemini 3 function calling 的 thought signature 规则，以及 Chatbox 在 Agent Mode / Code Execution 场景下的历史序列化要求。背景问题来自 `gemini-3.1-pro-preview` 在一次响应中并行生成大量 `code_execution` 调用，达到 25 次工具调用暂停后，点击继续时 Google API 返回：

```text
Function call is missing a thought_signature in functionCall parts.
```

## 协议规则

Gemini 3 的 function calling 对当前 turn 执行严格 signature 校验。当前 turn 指从最近一条普通 user text message 开始，到后续所有 model `functionCall` 和 user/tool `functionResponse` steps。

关键规则：

- 单个 function call：该 `functionCall` part 会带 `thoughtSignature`，下一次请求必须原样带回。
- 并行 function calls：同一个 model response 内只有第一个 `functionCall` part 带 `thoughtSignature`，后续并行 `functionCall` 没有 signature 是正常行为。
- 顺序 multi-step function calls：每个 step 的第一个 `functionCall` 都会带自己的 signature，后续请求必须累计带回所有 step 的 signature。
- 如果某个 step 的第一个 `functionCall` 确实没有 signature，例如历史由客户端确定性构造或跨模型迁移，可以使用 Google 文档允许的 dummy signature：`skip_thought_signature_validator`。

并行调用的正确回传形态必须保持为一个 model/assistant 消息后接一个 tool 消息：

```text
assistant/model parts:
  FC1 + thoughtSignature
  FC2
  FC3

tool/user parts:
  FR1
  FR2
  FR3
```

不能交错成：

```text
assistant/model: FC1 + thoughtSignature
tool/user:      FR1
assistant/model: FC2
tool/user:      FR2
```

交错后，`FC2` 会被 Google 视为新的 step 的第一个 function call；由于它没有 signature，请求会 400。

## Chatbox 代码路径

相关文件：

- `packages/chatbox-core/src/generation/stream-chunk-processor.ts`
  - 从 AI SDK stream chunk 生成 `Message.contentParts`。
  - 保留 `chunk.providerMetadata.google.thoughtSignature`。
  - 为每个 tool call 记录 `stepIndex`（generation step 边界，来自 `finish-step` chunk）；同一 `stepIndex` 的 tool calls 即同一并行批次。
  - 暂停错误到达 `tool-error` 且没有先前 `tool-call` part 时，也要先创建并持久化 tool-call part，再抛出暂停错误。
- `src/shared/services/model-message-converter.ts`
  - 把 `Message.contentParts` 转成 AI SDK `ModelMessage[]`。
  - 有相同 `stepIndex` 的已完成 tool calls 会合并成一个 assistant message，并跟一个包含所有 tool results 的 tool message。
  - Gemini/Google API style 下，如果某个 step 的第一个 function call 缺 signature，才补 `skip_thought_signature_validator`。
  - 如果并行组第一个 call 已有真实 signature，后续并行 call 必须保持无 signature，不要给它们补 dummy signature。
- `src/renderer/stores/session/agent-harness.ts`
  - 只在 resolved `model.apiStyle === 'google'` 时启用 Google signature 兜底（`getModel()` 会为内置/自定义 Gemini provider 及 ChatboxAI google 路由模型统一打上 apiStyle）。
- `packages/chatbox-core/src/generation/GenerationService.ts`
  - 25 次工具调用暂停属于一个批次；继续时恢复该批次并执行剩余 tool calls，然后 append 到原 assistant 消息继续生成。
- `src/renderer/components/message-parts/ToolCallPartUI.tsx`
  - `tool_call_limit` 暂停批次只展示一个继续入口。
  - 普通审批暂停仍逐个展示；拒绝任意一个审批会停止该批次。

## 本次根因

复现 prompt：

```text
我要测试工具调用次数。请严格按下面要求做，不要合并步骤：
对 1 到 30 这 30 个数字，每个数字单独执行一次代码，每次只输出这一个数字。
必须分成 30 次独立的工具调用，绝对不要用循环，也不要一次输出多个数字。
```

在 Agent Mode on 并注入真实 Code Execution tools 时，`gemini-3.1-pro-preview` 一次返回 30 个 `code_execution` tool calls。实测只有第一个 tool call 带 `thoughtSignature`，后 29 个没有。这符合 Gemini 并行 function calling 规则。

原问题不是“后 29 个缺 signature”，而是 Chatbox 历史序列化把同一批并行调用拆成了多个 assistant/tool 对，形成：

```text
FC1 + signature, FR1, FC2, FR2, ...
```

当继续暂停后的请求发给 Google 时，后续 unsigned `FC2`、`FC14` 等被视为新 step 的第一个 function call，于是触发 400。

## 修复原则

- 保留 Google 返回的真实 `thoughtSignature`，不要丢失 `providerMetadata`。
- 用 `stepIndex`（provider generation step 边界）表达同一批并行 tool calls；继续生成时 `createInitialState` 会从历史最大值 +1 起步，避免新旧批次误合并。
- 序列化历史时，按并行组输出 `assistant: [FC...]` 然后 `tool: [FR...]`，禁止 interleave。
- 只在 step 的第一个 function call 缺 signature 时使用 `skip_thought_signature_validator`。
- 不把缺 signature 的 function call 降级成文本；这会破坏 tool result 与 model functionCall 的协议关系。
- 不通过修改底层 `toolChoice` 规避问题；复现和修复都应该走真实 Agent Mode tool path。

## 验证方式

最小有效验证应该覆盖两层：

1. 从用户第一条 prompt 开始，Agent Mode on，真实 Google provider + Chatbox Code Execution tools，确认模型返回并行 tool calls 且只有第一个带 signature。
2. 对暂停后的消息历史捕获最终 Google request body，确认：
   - 同一并行批次的 function calls 在同一个 model/assistant content block 内。
   - tool results 紧跟其后并保持同一顺序。
   - 每个 step 的第一个 function call 有真实 signature 或 `skip_thought_signature_validator`。
   - 后续并行 function calls 可以没有 signature。

单元测试应覆盖：

- Gemini thought signature 能从 stream chunk 保存到 `MessageToolCallPart.providerMetadata`。
- 同一 generation step 内的 tool calls 会得到相同 `stepIndex`，且快结果插队不会拆分批次。
- 有相同 `stepIndex` 的 tool calls 序列化为一个 assistant turn 和一个 matching tool-result turn。
- 未分组的连续 tool calls 仍按顺序 multi-step 序列化。
- 并行组第一个 call 有 signature 时，后续 call 不补 dummy signature。
- 第一个 call 缺 signature 时，Google/Gemini 序列化会补 `skip_thought_signature_validator`。

## Debugging 复盘

这次排查中有几个容易再次踩的坑：

- 不要只看已有 history 或 UI 截图推断根因。必须从第一条 user prompt 开始跑真实 Agent Mode tool path，确认模型到底返回了什么。
- 直接 Google API 不带 Agent Mode 工具说明时，模型可能不会调用工具；这不能证明 UI 路径没问题。
- 看到“后续 functionCall 没有 signature”时，不要立刻把所有后续 call 都补 dummy signature。Google 文档明确说明并行调用只有第一个带 signature。
- 400 里报 `position 4` / `position 14` 不等于那些原始并行 call 应该有 signature；它通常说明我们把并行组拆成了多个 step。
- 不要把 protocol 问题用“降级成文本”绕开。Gemini 需要看到原始 functionCall 和对应 functionResponse，才能正确消费 tool result。
- 不要先改 `toolChoice`、provider 底层参数或模型调用策略。这个问题属于 message history shape 和 provider metadata preservation。
- UI 行为和协议行为要分开验证：继续按钮展示数量属于 UI 批处理；Google 400 属于 request body 的 functionCall/functionResponse 顺序和 signature。

## 参考

- Google AI Developers: Thought Signatures - Generate Content API
- Google AI Developers: Gemini 3 Developer Guide - Function calling strict validation
- Google AI Developers: Using Tools with Gemini API
