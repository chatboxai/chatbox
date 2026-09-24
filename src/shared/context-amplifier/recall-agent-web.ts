/**
 * recall-agent-web.ts — 渲染进程可用的按戳召回
 *
 * recall-agent.js 用 Node 的 https 模块，在渲染进程里根本无法加载
 * （`require is not defined`，且 https 不存在）。这里用 fetch 重写传输层，
 * 系统提示词与证据约束和 Node 版保持一致。
 *
 * 双层召回：searchScope='compressed' 只搜 L1/L2/L3，'archive' 只搜远古区。
 */

import providerProfileCjs from './provider-profile.js'

const providerProfiles = (
  providerProfileCjs as unknown as {
    PROVIDER_PROFILES: Record<
      string,
      {
        format: string
        headers: (key: string, length: number) => Record<string, string>
        buildPayload: (model: string, systemPrompt: string, text: string, maxTokens: number) => Record<string, unknown>
        parseText: (data: unknown) => string
      }
    >
  }
).PROVIDER_PROFILES

const RECALL_AGENT_SYSTEM = [
  '你是按任务标识工作的召回子智能体。一次请求只处理一个任务标识对应的无损完整原文。',
  '你的职责是在完整原文中定位主模型提出的信息缺口，并返回最小、可审计的证据包；不是概括整个任务，更不是继续执行用户任务。',
  '只依据随请求提供的原文。原文不足、相互冲突或无法确定时，明确写"证据不足"，不得用常识补齐。',
  '先在脑中定位相关消息，再输出严格 JSON，不要 Markdown、解释前缀或额外字段：',
  '{"answer":"可直接给主模型使用的简洁答案","evidence":[{"message_index":0,"quote":"支持答案的最小原文摘录"}],"reason":"说明这些证据为何足够，或说明证据不足"}',
  'evidence 最多 4 项，每个 quote 最多 700 个字符；message_index 必须是随原文给出的 [MESSAGE:n] 编号。',
].join('\n')

export interface RecallInput {
  stamp: string
  question: string
  searchScope?: 'compressed' | 'archive'
}

export interface RecallResult {
  ok: boolean
  stamp: string
  searchScope: string
  layer?: string
  answer?: string
  evidence?: Array<{ message_index: number | null; quote: string }>
  reason?: string
  error?: string
}

interface StoreEntry {
  fullMessages?: Array<Record<string, unknown>>
  meta?: { layer?: string }
}

interface StoreLike {
  get(stamp: string): StoreEntry | null
  // 本地召回 fast path：仅 stamp-store.js 的 StampStore 实现，
  // recallByStampWeb 拿不到时回退到返回 null。contentToText 是 stamp-store
  // 导出的序列化工具，把 Chatbox Message.content 序列化成可读文本片段。
  retrieve?: (
    stamp: string,
    options: { mode?: 'full' | 'relevant'; query?: string; maxSegments?: number }
  ) => {
    stamp: string
    mode: string
    found: boolean
    content: string
    segments: number
    query?: string
  } | null
}

function parseJson(text: string): Record<string, unknown> | null {
  const source = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start === -1 || end < start) return null
  try {
    return JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
}

function fullBlockText(entry: StoreEntry): string {
  return (entry.fullMessages ?? [])
    .map(
      (message, i) => `[MESSAGE:${i}][ROLE:${(message as { role?: string }).role ?? '?'}]\n${JSON.stringify(message)}`
    )
    .join('\n\n')
}

function boundedEvidence(value: unknown): Array<{ message_index: number | null; quote: string }> {
  const list = Array.isArray(value) ? value : []
  return list
    .slice(0, 4)
    .map((item) => {
      const r = item as { message_index?: unknown; quote?: unknown }
      return {
        message_index: Number.isInteger(r?.message_index) ? (r.message_index as number) : null,
        quote: String(r?.quote ?? '').slice(0, 700),
      }
    })
    .filter((item) => item.quote)
}

export async function recallByStampWeb(
  store: StoreLike,
  input: RecallInput,
  opts?: { endpoint: string; apiKey: string; model: string; format?: string; timeout?: number }
): Promise<RecallResult> {
  const stamp = String(input?.stamp || '').trim()
  const question = String(input?.question || '')
    .trim()
    .slice(0, 4000)
  const searchScope = input?.searchScope === 'archive' ? 'archive' : 'compressed'

  if (!/^[0-9a-f]{12}$/i.test(stamp)) {
    return { ok: false, stamp, searchScope, error: '召回戳格式无效' }
  }
  if (!question) return { ok: false, stamp, searchScope, error: '召回缺少问题' }

  const entry = store.get(stamp)
  if (!entry) return { ok: false, stamp, searchScope, error: `未找到戳 ${stamp}` }
  if (!question) return { ok: false, stamp, searchScope, error: '召回缺少问题' }

  const layer = entry.meta?.layer
  if (searchScope === 'compressed' && layer === 'ARCHIVE') {
    return { ok: false, stamp, searchScope, layer, error: `戳 ${stamp} 在远古区，请用 searchScope='archive'` }
  }
  if (searchScope === 'archive' && layer !== 'ARCHIVE') {
    return { ok: false, stamp, searchScope, layer, error: `戳 ${stamp} 不在远古区（layer=${layer}）` }
  }

  const source = fullBlockText(entry)
  // ── Fast path：L0/L1/ARCHIVE 直接从 store 取原文，不调 API ──
  // 解决召回 401（双链路 endpoint 不一致）+ 让 L0/L1 可召回。
  // L2/L3 仍走 LLM 召回——它们的 fullMessages 是已经摘要过的，密度低，
  // 模型需要 LLM 定位；保留 fast path 不接管。
  //
  // 选层条件：
  //   - 'compressed' 范围：layer 不是 L2/L3（即 L0/L1/未设）→ fast path
  //   - 'archive' 范围：layer 是 ARCHIVE → fast path
  //   - 其他组合（com+L2/L3 / archive+非 ARCHIVE）→ 走 LLM 路径
  const fastPathApplicable =
    (searchScope === 'compressed' && layer !== 'L2' && layer !== 'L3') ||
    (searchScope === 'archive' && layer === 'ARCHIVE')
  if (fastPathApplicable && typeof store.retrieve === 'function') {
    const isFullMode = false
    const local = store.retrieve(stamp, {
      mode: 'relevant',
      query: question,
      maxSegments: searchScope === 'archive' ? 6 : 4,
    })
    if (local?.found) {
      return {
        ok: true,
        stamp,
        searchScope,
        layer,
        answer: local.content,
        evidence: [],
        reason: isFullMode
          ? '已从本地 StampStore 取回完整原文（fast path）'
          : `已从本地 StampStore 按问题定位相关片段（fast path，${local.segments} 段）`,
      }
    }
    // 本地 store 拿不到（可能 entry 存在但 retrieve 返回 null）→ 退到 LLM 路径兜底
  }
  if (!opts?.endpoint || !opts.apiKey || !opts.model) {
    return { ok: false, stamp, searchScope, layer, error: '未配置召回服务凭据' }
  }

  const profile = providerProfiles[opts.format === 'anthropic' ? 'ling' : 'glm']
  const requestText = [
    `#STAMP ${stamp}`,
    `#SCOPE ${searchScope}`,
    '#QUESTION',
    question,
    '#FULL_TASK_BLOCK_BEGIN',
    source.slice(0, 900_000),
    '#FULL_TASK_BLOCK_END',
  ].join('\n')

  // 与 compress / curator 统一：5 次重试，1/2/4/8/16s 退避。
  // 召回路径缺这一步是真实痛点——共享代理瞬时 503/429（"system cpu overloaded"
  // 之类）会直接返回错误，模型就退回去重新探索文件。重试能把大多数瞬时
  // 抖动吞掉，且不重复打 recall 子智能体以外的副作用。
  const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]
  const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

  let lastError = '未知错误'
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeout ?? 90_000)
    try {
      const body = JSON.stringify(profile.buildPayload(opts.model, RECALL_AGENT_SYSTEM, requestText, 8000))
      const headers = profile.headers(opts.apiKey, new TextEncoder().encode(body).byteLength)
      delete headers['Content-Length']
      const response = await fetch(opts.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        lastError = `召回请求失败 HTTP ${response.status}`
        if (RETRYABLE_STATUS.has(response.status) && attempt < RETRY_DELAYS_MS.length) {
          const wait = RETRY_DELAYS_MS[attempt]
          console.warn(`[Recall] ${response.status}，${wait / 1000}s 后重试 (${attempt + 1}/${RETRY_DELAYS_MS.length})`)
          await new Promise((resolve) => setTimeout(resolve, wait))
          continue
        }
        return { ok: false, stamp, searchScope, layer, error: lastError }
      }

      const data = await response.json()
      const text = profile.parseText(data)
      const parsed = parseJson(text)
      if (!parsed || typeof parsed.answer !== 'string') {
        // 模型返回空/非 JSON 是稳态错误，重试也拿不到，不浪费请求
        return { ok: false, stamp, searchScope, layer, error: '召回未返回有效 JSON' }
      }

      return {
        ok: true,
        stamp,
        searchScope,
        layer,
        answer: parsed.answer.trim(),
        evidence: boundedEvidence(parsed.evidence),
        reason: String(parsed.reason ?? ''),
      }
    } catch (error) {
      lastError = `召回异常: ${error instanceof Error ? error.message : String(error)}`
      if (attempt < RETRY_DELAYS_MS.length) {
        const wait = RETRY_DELAYS_MS[attempt]
        console.warn(`[Recall] 异常，${wait / 1000}s 后重试 (${attempt + 1}/${RETRY_DELAYS_MS.length}): ${lastError}`)
        await new Promise((resolve) => setTimeout(resolve, wait))
        continue
      }
      return { ok: false, stamp, searchScope, layer, error: lastError }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, stamp, searchScope, layer, error: lastError }
}

export function renderRecallResultWeb(result: RecallResult): string {
  if (!result.ok) return `[RECALL_AGENT][ERROR] ${result.error || '未知错误'}`
  const layerLabel = result.layer ? ` [来源:${result.layer}]` : ''
  const evidence = (result.evidence ?? [])
    .map((item, i) => `[EVIDENCE ${i + 1}][MESSAGE:${item.message_index ?? '?'}]\n${item.quote}`)
    .join('\n\n')
  return [
    `[RECALL_AGENT][STAMP:${result.stamp}]${layerLabel}`,
    `#ANSWER ${result.answer}`,
    `#REASON ${result.reason || '已基于该戳完整原文核验'}`,
    evidence || '#EVIDENCE 无',
    '#END_RECALL_AGENT',
  ].join('\n')
}
