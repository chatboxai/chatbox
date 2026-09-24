/**
 * 按任务标识召回子智能体。
 * 主模型只指定一个任务标识和精确信息缺口；子智能体完整读取该标识唯一对应的
 * 无损任务块，在本地语义定位后仅回传最小证据包。主模型不会收到完整任务块。
 */
const https = require('https')

const DEFAULT_BASE = process.env.RECALL_AGENT_BASE || process.env.UP_BASE || 'https://api.sfkey.cn'
const DEFAULT_PATH = '/v1/chat/completions'
const DEFAULT_MODEL = process.env.RECALL_AGENT_MODEL || process.env.UP_MODEL || 'glm-5.2'
const DEFAULT_KEY = process.env.RECALL_AGENT_KEY || process.env.UP_KEY || ''
const REQUEST_CHUNK_BYTES = 225 * 1024

const RECALL_AGENT_SYSTEM = [
  '你是按任务标识工作的召回子智能体。一次请求只处理一个任务标识对应的无损完整原文。',
  '你的职责是在完整原文中定位主模型提出的信息缺口，并返回最小、可审计的证据包；不是概括整个任务，更不是继续执行用户任务。',
  '只依据随请求提供的原文。原文不足、相互冲突或无法确定时，明确写“证据不足”，不得用常识补齐。',
  '先在脑中定位相关消息，再输出严格 JSON，不要 Markdown、解释前缀或额外字段：',
  '{"answer":"可直接给主模型使用的简洁答案","evidence":[{"message_index":0,"quote":"支持答案的最小原文摘录"}],"reason":"说明这些证据为何足够，或说明证据不足"}',
  'evidence 最多 4 项，每个 quote 最多 700 个字符；message_index 必须是随原文给出的 [MESSAGE:n] 编号。',
].join('\n')

function request(messages, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const timeoutMs = Number(opts.timeout || 240000)
    let settled = false
    let deadline = null
    const settle = (result) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      resolve(result)
    }
    const base = opts.base || DEFAULT_BASE
    const url = new URL(base + (opts.path || DEFAULT_PATH))
    const payload = JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      messages,
      stream: false,
      temperature: 0,
      max_tokens: opts.maxTokens || 2400,
    })
    const body = Buffer.from(payload, 'utf8')
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey || DEFAULT_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          // 召回同样使用独立连接，避免与主回合共享代理侧的长请求状态。
          Connection: 'close',
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          try {
            const parsed = JSON.parse(raw)
            if (parsed.error) {
              settle({
                ok: false,
                error: parsed.error.message || JSON.stringify(parsed.error),
                statusCode: response.statusCode,
                elapsed: Date.now() - started,
              })
              return
            }
            const message = parsed.choices?.[0]?.message || {}
            const text = message.content || ''
            settle({
              ok: response.statusCode >= 200 && response.statusCode < 300 && !!text,
              text,
              usage: parsed.usage || null,
              statusCode: response.statusCode,
              elapsed: Date.now() - started,
            })
          } catch (error) {
            settle({
              ok: false,
              error: `JSON parse error: ${error.message}`,
              statusCode: response.statusCode,
              elapsed: Date.now() - started,
            })
          }
        })
        response.on('error', (error) =>
          settle({ ok: false, error: error.message, statusCode: response.statusCode, elapsed: Date.now() - started })
        )
      }
    )
    req.on('error', (error) => settle({ ok: false, error: error.message, elapsed: Date.now() - started }))
    req.on('timeout', () => {
      req.destroy()
      settle({ ok: false, error: 'timeout', elapsed: Date.now() - started })
    })
    deadline = setTimeout(() => {
      req.destroy()
      settle({ ok: false, error: 'absolute timeout', elapsed: Date.now() - started })
    }, timeoutMs)
    // 不等待 drain 后再发送下一片：部分代理会在请求 end 前不触发 drain，
    // 从而让声明了 Content-Length 的请求永远无法完成上传。
    for (let offset = 0; offset < body.length; offset += REQUEST_CHUNK_BYTES) {
      req.write(body.subarray(offset, Math.min(body.length, offset + REQUEST_CHUNK_BYTES)))
    }
    req.end()
  })
}

function parseJson(text) {
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

function fullBlockText(entry) {
  return entry.fullMessages
    .map((message, messageIndex) =>
      [`[MESSAGE:${messageIndex}][ROLE:${message.role}]`, JSON.stringify(message)].join('\n')
    )
    .join('\n\n')
}

function boundedEvidence(value) {
  const evidence = Array.isArray(value) ? value : []
  return evidence
    .slice(0, 4)
    .map((item) => ({
      message_index: Number.isInteger(item?.message_index) ? item.message_index : null,
      quote: String(item?.quote || '').slice(0, 700),
    }))
    .filter((item) => item.quote)
}

/**
 * 按戳召回，支持双层策略：
 * - searchScope='compressed' (默认)：只在压缩区(L1/L2/L3)查找
 * - searchScope='archive'：查找远古区(ARCHIVE)
 *
 * 主模型应先用 'compressed' 召回，找不到再降级到 'archive'。
 */
async function recallByStamp(store, input, opts = {}) {
  const stamp = String(input?.stamp || '')
  const question = String(input?.question || input?.query || '')
  const searchScope = input?.searchScope || 'compressed' // 'compressed' | 'archive'

  const entry = store.get(stamp)
  if (!entry) return { ok: false, error: `未找到戳 ${stamp}`, stamp, searchScope }
  if (!question) return { ok: false, error: '召回子智能体缺少问题', stamp, searchScope }

  // 检查作用域
  const layer = entry.meta?.layer
  if (searchScope === 'compressed' && layer === 'ARCHIVE') {
    return { ok: false, error: `戳 ${stamp} 在远古区，需要 searchScope='archive'`, stamp, searchScope, layer }
  }
  if (searchScope === 'archive' && layer !== 'ARCHIVE') {
    return { ok: false, error: `戳 ${stamp} 不在远古区（layer=${layer}）`, stamp, searchScope, layer }
  }

  const source = fullBlockText(entry)
  const response = await request(
    [
      { role: 'system', content: RECALL_AGENT_SYSTEM },
      {
        role: 'user',
        content: [
          `#STAMP ${stamp}`,
          `#SCOPE ${searchScope}`,
          '#QUESTION',
          question,
          '#FULL_TASK_BLOCK_BEGIN',
          source,
          '#FULL_TASK_BLOCK_END',
        ].join('\n'),
      },
    ],
    opts
  )
  if (!response.ok)
    return { ...response, stamp, searchScope, layer, sourceBytes: Buffer.byteLength(source), toolTrace: [] }
  const result = parseJson(response.text)
  if (!result || typeof result.answer !== 'string' || !Array.isArray(result.evidence)) {
    return {
      ok: false,
      error: '召回子智能体未返回有效 JSON',
      stamp,
      searchScope,
      layer,
      raw: String(response.text || '').slice(0, 2000),
      sourceBytes: Buffer.byteLength(source),
      elapsed: response.elapsed,
      usage: response.usage || null,
      toolTrace: [],
    }
  }
  const evidence = boundedEvidence(result.evidence)
  return {
    ok: true,
    stamp,
    searchScope,
    layer,
    answer: result.answer.trim(),
    evidence,
    reason: String(result.reason || ''),
    sourceBytes: Buffer.byteLength(source),
    returnedBytes: Buffer.byteLength(JSON.stringify({ answer: result.answer, evidence, reason: result.reason || '' })),
    elapsed: response.elapsed,
    usage: response.usage || null,
    toolTrace: [{ name: 'single_stamp_full_block', returnedBytes: Buffer.byteLength(source) }],
  }
}

function renderRecallResult(result) {
  if (!result.ok) return `[RECALL_AGENT][ERROR] ${result.error || '未知错误'}`
  const layerLabel = result.layer ? ` [来源:${result.layer}]` : ''
  const evidence = result.evidence
    .map((item, index) => `[EVIDENCE ${index + 1}][MESSAGE:${item.message_index ?? '?'}]\n${item.quote}`)
    .join('\n\n')
  return [
    `[RECALL_AGENT][STAMP:${result.stamp}]${layerLabel}`,
    `#ANSWER ${result.answer}`,
    `#REASON ${result.reason || '已基于该戳完整原文核验'}`,
    evidence || '#EVIDENCE 无',
    '#END_RECALL_AGENT',
  ].join('\n')
}

module.exports = { recallByStamp, renderRecallResult, RECALL_AGENT_SYSTEM, RECALL_TOOLS: [] }
