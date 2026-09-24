/**
 * chunked-chat.ts — 超长上下文 (>80K tokens) 走"非流式标准 POST"路径
 *
 * 背景：HTTP/1.1 传输本身完全够用（实测 OpenAI 兼容网关在 HTTP/1.1 下
 * 直连/代理均 200）。早期实现为绕过"浏览器 fetch 不支持流式上传 body"发明了
 * 分帧 + 自定义头（X-Stream-Id/X-Chunk-Index）协议，实测证明有害无益：
 *   - 自定义头被所有标准网关直接忽略（无意义）
 *   - 分帧 payload 不符合 OpenAI 标准（第 0 帧无 messages 字段、顶层 system、
 *     maxOutputTokens 而非 max_tokens）→ 网关直接 400
 *
 * 现方案：一个完整请求一次发完（body 再大也是一次 HTTP/1.1 POST，Chromium
 * fetch 自动处理大 body 上传），body 是**标准 OpenAI ChatCompletion 格式**：
 *   - system 并入 messages[0]（{role:'system'}）
 *   - maxOutputTokens → max_tokens
 *   - stream: false，一次性拿完整响应
 *   - 只带标准请求头（Content-Type / Authorization），不带任何自定义头
 *
 * 限制（沿袭设计取舍）：只支持纯文本问答，不支持工具调用与流式打字机效果。
 * 带工具调用的请求在 abstract-ai-sdk.ts 入口直接走标准 AI SDK 路径。
 */

import type { ModelMessage, TextStreamPart, ToolSet } from 'ai'
import type { ModelStreamPart } from './types'

/** 阈值：单次请求体估算 token 数超过它时走非流式直发路径 */
export const CHUNK_TOKEN_THRESHOLD = 80_000

export interface ChunkedChatInput {
  endpoint: string
  apiKey: string
  model: string
  messages: ModelMessage[]
  tools?: ToolSet
  system?: string
  temperature?: number
  maxOutputTokens?: number
  signal: AbortSignal
  /** 透传额外请求头（只允许标准头，不要传自定义协议头） */
  extraHeaders?: Record<string, string>
}

/**
 * 估算请求体总 token 数。
 * 字符数粗估（不调 BPE——js-tiktoken/lite 对长重复字符 BPE 极慢，O(n²)）
 */
export function estimateRequestTokens(input: {
  messages: ModelMessage[]
  system?: string
  tools?: ToolSet
  model: string
}): number {
  let total = 0
  if (input.system) total += messageCharTokens(input.system)
  if (input.tools) total += messageCharTokens(JSON.stringify(input.tools))
  for (const m of input.messages) {
    if (typeof m.content === 'string') {
      total += messageCharTokens(m.content)
    } else {
      for (const p of m.content) {
        if (p.type === 'text') total += messageCharTokens(p.text)
      }
    }
  }
  return Math.max(1, total)
}

function messageCharTokens(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      n += 1.5
    } else {
      n += 0.25
    }
  }
  return Math.max(0, n)
}

function messageText(m: ModelMessage): string {
  if (typeof m.content === 'string') return m.content
  let text = ''
  for (const p of m.content) {
    if (p.type === 'text') {
      text += p.text
    } else if (p.type === 'tool-result') {
      text += toolResultText(p.output)
    }
  }
  return text
}

function toolResultText(output: unknown): string {
  if (Array.isArray(output)) {
    return output
      .map(toolResultText)
      .filter(Boolean)
      .join('\n')
  }
  if (output && typeof output === 'object' && (output as { type?: string }).type === 'text') {
    // AI SDK 的 text 输出字段为 value
    const o = output as { value?: string; text?: string }
    return o.value ?? o.text ?? ''
  }
  return ''
}

/**
 * ModelMessage（AI SDK 格式）→ OpenAI 标准 messages 数组（纯文本子集）。
 * - system 参数置为 messages[0]
 * - tool 角色消息降级为 user 文本（本路径不支持工具调用，保底不丢信息）
 * - 非文本 part（图片/文件等）被跳过
 */
export function toOpenAIMessages(
  messages: ModelMessage[],
  system?: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (system) {
    out.push({ role: 'system', content: system })
  }
  for (const m of messages) {
    if (m.role === 'tool') {
      const text = messageText(m)
      if (text) out.push({ role: 'user', content: `[工具结果] ${text}` })
      continue
    }
    const role = m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user'
    const text = messageText(m)
    if (text) out.push({ role, content: text })
  }
  return out
}

/**
 * OpenAI ChatCompletion 兼容响应（最小子集）
 */
interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content?: string | null
      role?: string
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * 主入口：构造标准 OpenAI 请求体，单次 POST，对外 yield ModelStreamPart。
 */
export async function* chunkedChatStream<T extends ToolSet = ToolSet>(
  input: ChunkedChatInput
): AsyncGenerator<ModelStreamPart<T>> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: toOpenAIMessages(input.messages, input.system),
    stream: false,
  }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxOutputTokens !== undefined) body.max_tokens = input.maxOutputTokens

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    ...(input.extraHeaders || {}),
  }

  // 单次完整 POST，无分帧、无自定义头
  const response = await fetch(input.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: input.signal,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`长上下文直发路径请求失败 HTTP ${response.status}: ${text.slice(0, 500)}`)
  }

  let parsed: OpenAIChatResponse
  try {
    parsed = JSON.parse(text) as OpenAIChatResponse
  } catch {
    throw new Error('长上下文直发路径：响应不是有效 JSON: ' + text.slice(0, 200))
  }

  const choice = parsed.choices?.[0]
  const content = choice?.message?.content ?? ''

  // yield text 三件套（一次性给完整 content）
  const textId = 't0'
  yield { type: 'text-start', id: textId } as TextStreamPart<T>
  yield { type: 'text-delta', id: textId, text: content } as TextStreamPart<T>
  yield { type: 'text-end', id: textId } as TextStreamPart<T>

  // yield finish
  yield {
    type: 'finish',
    finishReason: (choice?.finish_reason as 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown' | undefined) ?? 'stop',
    totalUsage: {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
      totalTokens: parsed.usage?.total_tokens ?? 0,
    },
  } as TextStreamPart<T>
}
