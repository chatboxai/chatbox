/**
 * curator-client.ts — L2 结构化记忆的调用协议
 *
 * 按 function-calling 协议驱动整理子智能体：把填字工具交给模型，要求它调用
 * 该工具提交结构化记忆，从 `tool_calls` 读取参数。
 *
 * 不用"发提示词求文本、再正则抠 JSON"的做法——那样丢掉了 schema 强制约束，
 * 模型可以返回任意形状，校验只能事后补救。工具调用让服务端按 schema 约束输出。
 *
 * 校验失败时把错误作为 tool 消息回传，让模型在同一对话里修正后重新提交，
 * 而不是丢弃整轮重来。
 *
 * schema / 提示词 / 必填字段全部来自 curator-config.ts（外部注入）。
 */

import { getCuratorConfig } from './curator-config'

export interface CuratorCallResult {
  ok: boolean
  /** 模型提交的结构化记忆（已通过必填字段校验） */
  payload?: Record<string, unknown>
  error?: string
  attempts: number
  elapsedMs: number
}

interface ChatMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id?: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]

/**
 * 让整理子智能体对一个任务块产出结构化记忆。
 *
 * @param blockText 任务块的完整序列化文本（不截断——截断等于绕过压缩丢信息）
 * @param stamp 任务块戳，供提示词定位
 * @param api 压缩服务凭据
 */
export async function callCurator(
  blockText: string,
  stamp: string,
  api: { endpoint: string; apiKey: string; model: string; timeout?: number }
): Promise<CuratorCallResult> {
  const started = Date.now()
  const config = getCuratorConfig()
  if (!config) {
    return { ok: false, error: 'curator 未配置（CTX_AMP_CURATOR）', attempts: 0, elapsedMs: 0 }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: config.systemPrompt },
    {
      role: 'user',
      content: [`#TASK_STAMP ${stamp}`, '#TASK_BLOCK_BEGIN', blockText, '#TASK_BLOCK_END'].join('\n'),
    },
  ]

  const maxAttempts = config.maxAttempts ?? 5
  let lastError = '未知错误'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await requestWithBackoff(messages, config.tool, api)

    if (!response.ok) {
      lastError = response.error ?? '请求失败'
      // 传输层失败：不追加对话，直接重试
      continue
    }

    const call = response.toolCalls?.find((c) => c.function?.name === config.toolName)
    if (!call) {
      lastError = `模型未调用 ${config.toolName}`
      messages.push({ role: 'assistant', content: response.text ?? null, tool_calls: response.toolCalls })
      messages.push({
        role: 'user',
        content: `你必须调用 ${config.toolName} 提交结构化记忆，自然语言回复无效。`,
      })
      continue
    }

    const payload = parseArguments(call.function.arguments)
    if (!payload) {
      lastError = '工具参数不是合法 JSON'
      messages.push({ role: 'assistant', content: null, tool_calls: response.toolCalls })
      messages.push({ role: 'tool', tool_call_id: call.id, content: '参数 JSON 解析失败，请重新提交。' })
      continue
    }

    const missing = (config.requiredFields ?? []).filter((field) => isEmpty(payload[field]))
    if (missing.length > 0) {
      lastError = `缺少必填字段: ${missing.join(', ')}`
      // 把校验错误作为 tool 结果回传，让模型在同一对话里修正
      messages.push({ role: 'assistant', content: null, tool_calls: response.toolCalls })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `提交被拒绝，缺少或为空的字段：${missing.join('、')}。请补全后重新调用。`,
      })
      continue
    }

    return { ok: true, payload, attempts: attempt, elapsedMs: Date.now() - started }
  }

  return { ok: false, error: lastError, attempts: maxAttempts, elapsedMs: Date.now() - started }
}

async function requestWithBackoff(
  messages: ChatMessage[],
  tool: Record<string, unknown>,
  api: { endpoint: string; apiKey: string; model: string; timeout?: number }
): Promise<{
  ok: boolean
  text?: string
  toolCalls?: Array<{ id?: string; type: string; function: { name: string; arguments: string } }>
  error?: string
}> {
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), api.timeout ?? 120_000)
    try {
      const res = await fetch(api.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({
          model: api.model,
          messages,
          tools: [tool],
          tool_choice: 'auto',
          temperature: 0,
          // 思考模型的 reasoning tokens 与输出共享预算，结构化记忆字段较多，留足空间
          max_tokens: 16000,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) {
        const data = await res.json()
        const message = data?.choices?.[0]?.message ?? {}
        return {
          ok: true,
          text: message.content ?? undefined,
          toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        }
      }

      if (!RETRYABLE_STATUS.has(res.status) || i === RETRY_DELAYS_MS.length) {
        return { ok: false, error: `HTTP ${res.status}` }
      }
      await sleep(RETRY_DELAYS_MS[i])
    } catch (error) {
      clearTimeout(timer)
      if (i === RETRY_DELAYS_MS.length) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      await sleep(RETRY_DELAYS_MS[i])
    }
  }
  return { ok: false, error: '重试耗尽' }
}

function parseArguments(serialized: string): Record<string, unknown> | null {
  try {
    const value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
