/**
 * 召回 401 修复 + L0/L1 本地 fast path 的单元测试（Plan B）。
 *
 * 5 个用例覆盖：
 * 1. L1 命中 → fast path → 不调 fetch
 * 2. ARCHIVE 命中 + searchScope='archive' → fast path
 * 3. L0 命中 → fast path（L0 块不进 store，但 tool-use 残留可命中）
 * 4. L2 + searchScope='compressed' → 走 fetch（mock 200）
 * 5. L3 + searchScope='compressed' → 走 fetch
 *
 * Mock 策略：vi.stubGlobal('fetch', vi.fn()) — 验证 L0/L1/ARCHIVE 路径不调 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recallByStampWeb, type RecallResult } from './recall-agent-web'

interface MockEntry {
  fullMessages: Array<Record<string, unknown>>
  summary: string
  status: string
  meta: { layer?: string }
}

interface MockStore {
  _map: Map<string, MockEntry>
  get(stamp: string): MockEntry | null
  retrieve(
    stamp: string,
    options: { mode?: 'full' | 'relevant'; query?: string; maxSegments?: number }
  ): { stamp: string; mode: string; found: boolean; content: string; segments: number; query?: string } | null
}

function makeStore(entries: Record<string, Partial<MockEntry>>): MockStore {
  const map = new Map<string, MockEntry>()
  for (const [stamp, partial] of Object.entries(entries)) {
    const fullMessages = partial.fullMessages ?? [
      { role: 'user', content: `用户问题 ${stamp}` },
      { role: 'assistant', content: `助手回答 ${stamp}` },
    ]
    map.set(stamp, {
      fullMessages,
      summary: partial.summary ?? `summary ${stamp}`,
      status: partial.status ?? 'done',
      meta: partial.meta ?? {},
    })
  }
  return {
    _map: map,
    get(stamp) {
      return map.get(stamp) ?? null
    },
    retrieve(stamp, options) {
      const entry = map.get(stamp)
      if (!entry) return null
      const mode = options.mode === 'full' ? 'full' : 'relevant'
      const query = String(options.query || '')
      if (mode === 'full') {
        return {
          stamp,
          mode,
          found: true,
          content: entry.fullMessages.map((m) => JSON.stringify(m)).join('\n'),
          segments: entry.fullMessages.length,
        }
      }
      // relevant mode：把所有消息按 query 长度简单 score
      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2)
      const scored = entry.fullMessages.map((m, i) => {
        const text = JSON.stringify(m).toLowerCase()
        const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0)
        return { i, m, score }
      })
      const maxSegments = Math.max(1, options.maxSegments || 4)
      const top = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSegments)
        .sort((a, b) => a.i - b.i)
      return {
        stamp,
        mode,
        found: true,
        content: top.map((t) => `[STAMP:${stamp}][MESSAGE:${t.i}]\n${JSON.stringify(t.m)}`).join('\n\n'),
        segments: top.length,
        query,
      }
    },
  }
}

const opts = {
  endpoint: 'https://api.sfkey.cn/v1/chat/completions',
  apiKey: 'sk-fake',
  model: 'glm-5.2',
  timeout: 5000,
}

describe('retrieve_by_stamp fast path (Plan B)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('L1 命中 store → 不调 fetch → 直接返回本地检索结果', async () => {
    const store = makeStore({
      a1b2c3d4e5f6: {
        fullMessages: [
          { role: 'user', content: '如何配 api.ant-ling.com 的 x-api-key header?' },
          {
            role: 'assistant',
            content: '在 compress-client.js:57-63 配 x-api-key + anthropic-version 头',
          },
        ],
        meta: { layer: 'L1' },
      },
    })
    const r: RecallResult = await recallByStampWeb(
      store,
      { stamp: 'a1b2c3d4e5f6', question: 'x-api-key 在哪里配' },
      opts
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
    expect(r.layer).toBe('L1')
    expect(r.answer).toContain('compress-client.js')
    expect(r.reason).toContain('fast path')
  })

  it('ARCHIVE 命中 + searchScope=archive → fast path', async () => {
    const store = makeStore({
      abcdefabcdef: {
        fullMessages: [{ role: 'user', content: '远古对话' }],
        meta: { layer: 'ARCHIVE' },
      },
    })
    const r = await recallByStampWeb(
      store,
      { stamp: 'abcdefabcdef', question: '远古', searchScope: 'archive' },
      opts
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
    expect(r.layer).toBe('ARCHIVE')
    expect(r.answer).toContain('远古对话')
  })

  it('L0 命中 → fast path', async () => {
    const store = makeStore({
      bb00bb00bb00: { fullMessages: [{ role: 'user', content: 'L0 内容' }], meta: { layer: 'L0' } },
    })
    const r = await recallByStampWeb(
      store,
      { stamp: 'bb00bb00bb00', question: 'L0' },
      opts
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
    expect(r.layer).toBe('L0')
  })

  it('L2 + searchScope=compressed → 走 fetch（mock 200 + JSON）', async () => {
    const store = makeStore({
      c2c2c2c2c2c2: { fullMessages: [{ role: 'user', content: 'L2 content' }], meta: { layer: 'L2' } },
    })
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: 'LLM 召回的答案',
                evidence: [{ message_index: 0, quote: '摘录' }],
                reason: '足够',
              }),
            },
          },
        ],
      }),
    })
    const r = await recallByStampWeb(
      store,
      { stamp: 'c2c2c2c2c2c2', question: 'L2 查询' },
      opts
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.answer).toBe('LLM 召回的答案')
    expect(r.evidence).toEqual([{ message_index: 0, quote: '摘录' }])
  })

  it('L3 + searchScope=compressed → 走 fetch', async () => {
    const store = makeStore({
      d3d3d3d3d3d3: { fullMessages: [{ role: 'user', content: 'L3 content' }], meta: { layer: 'L3' } },
    })
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ answer: 'L3 答案', evidence: [], reason: 'r' }),
            },
          },
        ],
      }),
    })
    const r = await recallByStampWeb(
      store,
      { stamp: 'd3d3d3d3d3d3', question: 'L3 查询' },
      opts
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.answer).toBe('L3 答案')
  })
})
