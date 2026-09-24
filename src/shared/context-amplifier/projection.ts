/**
 * projection.ts — 有界工具结果投影（对齐 agent-shell ADR-036）。
 *
 * 单条工具结果超过 PROJECTION_TOKEN_LIMIT 时保头（70%）保尾（30%）投影，
 * 全文以工具级内容寻址戳存入 StampStore（layer=PROJECTED），上下文里的
 * 标记含 #STAMP 戳，模型沿用既有 retrieve_by_stamp 工具即可召回原文。
 *
 * 关键约束：
 * - 只构造发往 LLM 的新消息数组，绝不改动 session 存储的 canonical 历史；
 * - 在 amplifyContext 与 applyToolCleanup 之后运行：压缩/归档输入保持无损
 *   （test-tool-preservation 不变量），stub 掉的旧结果不再浪费投影；
 * - 幂等：已含 [tool-result-projection] 的结果跳过，防止戳漂移与 store 污染。
 */
import { estimateTokens } from '../token-estimation/tokenizer'
import type { Message, MessageContentParts } from '../types'
import type { StampStoreLike } from './pipeline'
import sha256Cjs from './sha256.js'

const { sha256Hex } = sha256Cjs as unknown as { sha256Hex: (input: string) => string }

/** 单条工具结果的上下文预算（tokens），与 agent-shell ADR-036 一致。 */
export const PROJECTION_TOKEN_LIMIT = 20_000

export interface ProjectOptions {
  store: StampStoreLike
}

export function stampOfToolResult(toolCallId: string, toolName: string, content: string): string {
  return sha256Hex(`${toolCallId}:${toolName}:${content.slice(0, 100)}`).slice(0, 12)
}

function resultToText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result == null) return ''
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

export function projectToolResults(messages: Message[], options: ProjectOptions): Message[] {
  const { store } = options
  return messages.map((message) => {
    const parts = message.contentParts
    if (!parts?.some((p) => p.type === 'tool-call' && p.state === 'result')) return message

    let changed = false
    const next: MessageContentParts = parts.map((part) => {
      if (part.type !== 'tool-call' || part.state !== 'result') return part
      const text = resultToText(part.result)
      if (text.includes('[tool-result-projection]')) return part
      const estimated = estimateTokens(text)
      if (estimated <= PROJECTION_TOKEN_LIMIT) return part

      const stamp = stampOfToolResult(part.toolCallId, part.toolName, text)
      store.add(
        stamp,
        [{ role: 'tool', content: text }],
        `[tool-result-projection] ${part.toolName} 原文约 ${estimated} tokens`,
        'done',
        { layer: 'PROJECTED', toolName: part.toolName }
      )

      const ratio = PROJECTION_TOKEN_LIMIT / estimated
      const headLen = Math.max(1, Math.floor(text.length * ratio * 0.7))
      const tailLen = Math.max(1, Math.floor(text.length * ratio * 0.3))
      const projected = [
        text.slice(0, headLen),
        `[tool-result-projection] 省略约 ${estimated - PROJECTION_TOKEN_LIMIT} tokens（原文约 ${estimated} tokens，保留 70% 头部 / 30% 尾部）。`,
        `完整原文可通过 #STAMP ${stamp} 调用 retrieve_by_stamp 召回。`,
        text.slice(text.length - tailLen),
      ].join('\n')

      changed = true
      return { ...part, result: projected }
    })

    return changed ? { ...message, contentParts: next } : message
  })
}
