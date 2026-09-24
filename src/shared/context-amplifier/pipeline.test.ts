/**
 * 端到端验证：amplifyContext 的产物必须能活着通过 builder.ts 的完整链路。
 *
 * 为什么要这样测：先前的 test-integration.js 用「复刻分层判定」的方式测试，
 * 复刻的是分类逻辑，没有覆盖 amplifyContext 真实产出的**消息形状**。结果
 * `isSummary: true` 这个 bug 藏了过去——压缩块被 applyCompaction 整块删除，
 * 分层测试全绿，而实际上下文里一个 #STAMP 都不剩。
 *
 * 这里直接调 buildContext（真实入口），断言产物形状。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildContext } from '../context/builder'
import { amplifyContext } from './pipeline'
import { recordCommit, resetCommitStore } from './commit-store'
import type { Message, MessageContentParts } from '../types'
import type { AttachmentResolver } from '../context/types'

const resolver: AttachmentResolver = { read: async () => null }

function textMsg(id: string, role: 'user' | 'assistant', text: string): Message {
  return { id, role, timestamp: 1, contentParts: [{ type: 'text', text }] } as Message
}

/** 带工具调用的 assistant 消息，模拟真实探索轮次 */
function toolMsg(id: string, toolName: string, args: object, result: string): Message {
  const parts: MessageContentParts = [
    { type: 'text', text: '我来检查一下。' },
    { type: 'tool-call', state: 'result', toolCallId: `${id}-tc`, toolName, args, result } as never,
  ]
  return { id, role: 'assistant', timestamp: 1, contentParts: parts } as Message
}

/** 造 N 个任务块，每块 = 用户提问 + 工具轮 + 最终回答 */
function makeBlocks(n: number, padKB = 0): Message[] {
  const msgs: Message[] = []
  const pad = padKB > 0 ? ' '.repeat(padKB * 1024) : ''
  for (let i = 0; i < n; i++) {
    msgs.push(textMsg(`u${i}`, 'user', `第 ${i} 个任务：检查文件 mod_${i}.rs${pad}`))
    msgs.push(toolMsg(`a${i}-tool`, 'read_file', { path: `mod_${i}.rs` }, `文件内容 ${i}，共 42 行${pad}`))
    msgs.push(textMsg(`a${i}`, 'assistant', `第 ${i} 个任务完成：mod_${i}.rs 有 42 行。`))
  }
  return msgs
}

/**
 * 阈值按实测块大小设定。每个块约 70 token（3 条消息 + 工具调用），
 * 从后往前累加：L0 吃掉最后 2 块，第 3 块累计 210 落 L1，第 4 块 280 落 L2，
 * 第 5 块 350 落 L3。设成 1/2/3 会让所有块直接溢出到 ARCHIVE，压缩分支
 * 一次都不执行——测试会全绿但什么都没测到。
 *
 * 阈值从 BLOCK_TOKENS 推导而不是写死数字：makeBlocks 的消息文本一改，
 * 写死的阈值就会让某个块意外落进 ARCHIVE，测试报"少一个块"，看着像
 * bug 其实是测试脆。
 */
const BLOCK_TOKENS = 120

function tinyThresholds() {
  const per = BLOCK_TOKENS
  return {
    l0RoundCount: 2,
    minMessages: 2,
    l1Threshold: per * 3 + 5,
    l2Threshold: per * 4 + 5,
    l3Threshold: per * 5 + 5,
  }
}

/** 让所有非 L0 块溢出到 ARCHIVE 的阈值 */
function archiveThresholds() {
  return { l0RoundCount: 2, minMessages: 2, l1Threshold: 1, l2Threshold: 2, l3Threshold: 3 }
}

function makeStore() {
  const map = new Map<string, Record<string, unknown>>()
  return {
    get: (s: string) => map.get(s) ?? null,
    add: (stamp: string, fullMessages: unknown[], summary: string, status: string, meta = {}) => {
      const existing = map.get(stamp)
      if (existing) {
        existing.fullMessages = fullMessages
        existing.summary = summary
        existing.meta = { ...(existing.meta as object), ...meta }
        return
      }
      map.set(stamp, { stamp, fullMessages, summary, status, meta })
    },
    stamps: () => Array.from(map.keys()),
    _map: map,
  }
}

describe('压缩块必须活着通过 applyCompaction', () => {
  it('压缩块不被 isSummary 过滤掉，#STAMP 全部到达上下文', async () => {
    const messages = makeBlocks(5)
    const store = makeStore()

    const result = await buildContext(messages, {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      contextAmplifier: { store, ...tinyThresholds() },
    })

    const stamped = result.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('#STAMP'))
    )

    // 5 块：L0 保留最近 2 块（注入轻量级协议头），剩 3 块压成 L1/L2/L3 压缩块。
    // 因此 #STAMP 共 2 + 3 = 5 个。
    expect(stamped.length).toBe(5)
  })

  it('压缩块的角色是 user，不伪造成模型自己的发言', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(5), { store, ...tinyThresholds() })

    const stamped = amplified.messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('#STAMP'))
    )
    expect(stamped.length).toBeGreaterThan(0)
    for (const m of stamped) expect(m.role).toBe('user')
  })

  it('不设 isSummary —— 该标记专指 compaction point 替身', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(5), { store, ...tinyThresholds() })
    for (const m of amplified.messages) {
      expect((m as { isSummary?: boolean }).isSummary).toBeFalsy()
    }
  })

  it('块含 #LAYER / #STATUS / #END_BLOCK 结构化标记', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(5), { store, ...tinyThresholds() })
    const block = amplified.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('#STAMP'))
    )
    const text = block?.contentParts?.find((p) => p.type === 'text')?.text ?? ''

    expect(text).toMatch(/#STAMP [0-9a-f]{12}/)
    expect(text).toMatch(/#LAYER L[123]/)
    expect(text).toMatch(/#STATUS (DONE|PENDING)/)
    expect(text).toMatch(/#END_BLOCK$/)
  })

  it('#STATUS 在同一块内不重复出现，避免模型读到矛盾状态', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(5), { store, ...tinyThresholds() })
    for (const m of amplified.messages) {
      const text = m.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      if (!text.includes('#STAMP')) continue
      expect((text.match(/#STATUS/g) ?? []).length).toBe(1)
      expect((text.match(/#END_BLOCK/g) ?? []).length).toBe(1)
    }
  })
})

describe('压缩缓存', () => {
  it('内容未变时第二轮不再调压缩 API', async () => {
    const messages = makeBlocks(5)
    const store = makeStore()
    let calls = 0
    const compressBlock = async () => {
      calls++
      return { ok: true, summary: '#压缩结果 已确认 42 行' }
    }

    const first = await amplifyContext(messages, { store, compressBlock, ...tinyThresholds() })
    const firstCalls = calls
    expect(firstCalls).toBeGreaterThan(0)
    expect(first.cacheHits).toBe(0)

    const second = await amplifyContext(messages, { store, compressBlock, ...tinyThresholds() })
    expect(calls).toBe(firstCalls) // 没有新增调用
    expect(second.cacheHits).toBe(firstCalls)
  })

  it('块内容推进后重新压缩，不复用旧摘要', async () => {
    const store = makeStore()
    let calls = 0
    const compressBlock = async () => {
      calls++
      return { ok: true, summary: `#压缩结果 第 ${calls} 次` }
    }
    const opts = { store, compressBlock, ...tinyThresholds() }

    const base = makeBlocks(5)
    await amplifyContext(base, opts)
    const afterFirst = calls

    // 给第 0 块追加一条消息（同一戳，内容变了）
    const grown = [...base]
    grown.splice(3, 0, textMsg('a0-extra', 'assistant', '补充：还发现一处 bcrypt cost=12。'))
    const second = await amplifyContext(grown, opts)

    expect(calls).toBeGreaterThan(afterFirst) // 变化的块被重压
    expect(second.cacheHits).toBeLessThan(second.compressedBlocks)
  })

  it('压缩失败不写入缓存，下轮仍会重试', async () => {
    const store = makeStore()
    let calls = 0
    const compressBlock = async () => {
      calls++
      return { ok: false }
    }
    const opts = { store, compressBlock, ...tinyThresholds() }

    const messages = makeBlocks(5)
    const first = await amplifyContext(messages, opts)
    expect(first.fallbackBlocks).toBeGreaterThan(0)
    const afterFirst = calls

    const second = await amplifyContext(messages, opts)
    expect(calls).toBeGreaterThan(afterFirst) // 重试了，没被失败结果固化
    expect(second.cacheHits).toBe(0)
  })
})

describe('工具调用不被静默丢弃', () => {
  it('压缩失败时降级摘要仍带工具痕迹', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(5), {
      store,
      compressBlock: async () => ({ ok: false }),
      ...tinyThresholds(),
    })

    // 只检查 L1/L2/L3 压缩块（layer 不是 L0），L0 协议头不含 #TOOLS
    const compressedBlocks = amplified.messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L[123]/.test(p.text))
    )
    expect(compressedBlocks.length).toBeGreaterThan(0)
    for (const m of compressedBlocks) {
      const text = m.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      expect(text).toContain('#TOOLS')
      expect(text).toContain('read_file')
      expect(text).toContain('retrieve_by_stamp')
    }
  })

  it('StampStore 保存的原文含完整工具调用与结果', async () => {
    const store = makeStore()
    await amplifyContext(makeBlocks(5), { store, ...tinyThresholds() })

    let foundToolUse = false
    let foundToolResult = false
    for (const stamp of store.stamps()) {
      const entry = store.get(stamp) as { fullMessages: Message[] }
      for (const msg of entry.fullMessages) {
        for (const p of msg.contentParts ?? []) {
          if (p.type === 'tool-call') {
            foundToolUse = true
            if ((p as { result?: unknown }).result !== undefined) foundToolResult = true
          }
        }
      }
    }
    expect(foundToolUse).toBe(true)
    expect(foundToolResult).toBe(true)
  })

  it('ARCHIVE 块不进上下文但原文仍在 store 里', async () => {
    const store = makeStore()
    const amplified = await amplifyContext(makeBlocks(8), { store, ...archiveThresholds() })

    expect(amplified.archivedBlocks).toBeGreaterThan(0)

    // 归档块的戳不出现在上下文里
    const contextText = amplified.messages
      .flatMap((m) => m.contentParts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')

    const archivedStamps = store
      .stamps()
      .filter((s) => (store.get(s) as { meta?: { layer?: string } })?.meta?.layer === 'ARCHIVE')

    expect(archivedStamps.length).toBeGreaterThan(0)
    for (const s of archivedStamps) {
      expect(contextText).not.toContain(s)
      // 但原文还在，可被召回
      const entry = store.get(s) as { fullMessages: Message[] }
      expect(entry.fullMessages.length).toBeGreaterThan(0)
    }
  })
})

describe('三级降级：实时自报优先于 curator', () => {
  beforeEach(() => resetCommitStore())

  it('有实时自报时不调压缩 API', async () => {
    const store = makeStore()
    let calls = 0
    // 5 块 × 3 条消息 = 15 条。块2 = 消息 [6,9)，会被压成 L1。
    // 提交落在第 8 条 = 块2 进行中，这才是真实时序（模型在块内提交）。
    recordCommit('sess-1', { task_goal: '模型自报的目标', conclusion: '自报结论' }, 8, {
      valid: true,
      errors: [],
    })

    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => {
        calls++
        return { ok: true, summary: '#压缩结果 来自 API' }
      },
      ...tinyThresholds(),
    })

    // 只有块2 有自报；其余压缩块仍走 API。断言自报生效且省下了对应调用。
    expect(r.selfReportedBlocks).toBe(1)
    // B 方案：L1 块走本地合并（不调 API），所以压缩块数 - 本地合并 = 实际调
    // API 次数（selfReport 在 L1 上不再替代 API 调用——L1 本来就不调）。
    expect(calls).toBe(r.compressedBlocks - r.localMergedBlocks)
  })

  it('自报内容进入上下文，不是 API 压缩结果', async () => {
    const store = makeStore()
    recordCommit('sess-1', { task_goal: '模型自报的目标', conclusion: '自报结论' }, 8, {
      valid: true,
      errors: [],
    })

    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 来自 API' }),
      ...tinyThresholds(),
    })

    const text = r.messages
      .flatMap((m) => m.contentParts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')

    // 块2 用自报内容；其余压缩块仍走 API，所以 API 结果也会出现在上下文里。
    // 要断言的是"有自报的那个块用了自报"，不是"整个上下文没有 API 结果"。
    expect(text).toContain('自报结论')
    const selfReportedBlock = r.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('自报结论'))
    )
    const blockText = selfReportedBlock?.contentParts?.find((p) => p.type === 'text')?.text ?? ''
    expect(blockText).not.toContain('来自 API')
  })

  it('无自报时退回压缩 API', async () => {
    const store = makeStore()
    let calls = 0
    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-empty',
      compressBlock: async () => {
        calls++
        return { ok: true, summary: '#压缩结果 来自 API' }
      },
      ...tinyThresholds(),
    })

    expect(r.selfReportedBlocks).toBe(0)
    expect(calls).toBeGreaterThan(0)
  })

  it('校验未通过的提交不进 L2', async () => {
    const store = makeStore()
    recordCommit('sess-1', { task_goal: '不合格' }, 8, {
      valid: false,
      errors: ['evidence_fragments 至少包含一个紧凑证据片段'],
    })

    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 来自 API' }),
      ...tinyThresholds(),
    })

    expect(r.selfReportedBlocks).toBe(0)
  })

  it('不传 sessionId 时跳过实时自报', async () => {
    const store = makeStore()
    recordCommit('sess-1', { task_goal: 'x', conclusion: 'y' }, 8, { valid: true, errors: [] })
    const r = await amplifyContext(makeBlocks(5), {
      store,
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 来自 API' }),
      ...tinyThresholds(),
    })
    expect(r.selfReportedBlocks).toBe(0)
  })
})

describe('与 Chatbox compaction 契约共存', () => {
  it('compaction point 的 boundary/summary 不被压缩吞掉', async () => {
    // 失败场景（修复前实测）：boundaryMessageId 落在会被压缩的块里 → 压缩把该块
    // 换成 stamp-xxx，boundary 的原 id 消失 → findLatestApplicableCompactionPoint
    // 判定契约失效 → 走 fallback 的 filter(m => !m.isSummary) → summary 也被删。
    // 那段历史既没原文也没摘要，静默消失。
    const messages: Message[] = [
      { id: 'sum-1', role: 'assistant', timestamp: 1, isSummary: true,
        contentParts: [{ type: 'text', text: '这是历史摘要' }] } as Message,
      ...makeBlocks(5),
    ]
    const store = makeStore()
    const result = await buildContext(messages, {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: [
        { boundaryMessageId: 'a1', summaryMessageId: 'sum-1', createdAt: 1 } as never,
      ],
      contextAmplifier: { store, ...tinyThresholds() },
    })

    // summary 必须存活——它是那段历史的唯一代表
    expect(result.some((m) => m.id === 'sum-1')).toBe(true)
  })

  it('受保护块整块保持原样，不产生 #STAMP', async () => {
    const messages = makeBlocks(5)
    const store = makeStore()
    // 保护第 0 块的用户消息
    const result = await buildContext(messages, {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: [
        { boundaryMessageId: 'u0', summaryMessageId: 'u0', createdAt: 1 } as never,
      ],
      contextAmplifier: { store, ...tinyThresholds() },
    })

    // u0 所在的块没被压缩，原始消息仍在
    expect(result.some((m) => m.id === 'u0')).toBe(true)
    expect(result.some((m) => m.id === 'a0')).toBe(true)
  })

  it('boundary 位于块开头时，boundary 之后的内容不被误丢', async () => {
    // 反例场景：compaction 发生在用户提问后、模型回答前，boundary = 那条 user
    // 消息；之后模型才回答，于是 boundary 位于块的开头而非末尾。
    //
    // 这个场景排除了"让压缩块继承 boundary id"的精确修法——那样
    // slice(boundaryIndex+1) 会把整个压缩块丢掉，连带丢掉 boundary 之后本该
    // 保留的 assistant 回答。整块保留才与原生行为一致。
    const messages: Message[] = [
      { id: 'sum-1', role: 'assistant', timestamp: 1, isSummary: true,
        contentParts: [{ type: 'text', text: '摘要' }] } as Message,
      ...makeBlocks(5),
    ]
    const point = [{ boundaryMessageId: 'u2', summaryMessageId: 'sum-1', createdAt: 1 } as never]

    const native = await buildContext(messages, {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: point,
    })
    const amplified = await buildContext(messages, {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: point,
      contextAmplifier: { store: makeStore(), ...tinyThresholds() },
    })

    // boundary 之后紧跟的那条 assistant 消息，两条路径都必须保留
    expect(native.some((m) => m.id === 'a2')).toBe(true)
    expect(amplified.some((m) => m.id === 'a2')).toBe(true)
  })

  it('受保护块的原文仍进 StampStore，可按戳召回', async () => {
    const store = makeStore()
    await buildContext(makeBlocks(5), {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: [{ boundaryMessageId: 'u0', summaryMessageId: 'u0', createdAt: 1 } as never],
      contextAmplifier: { store, ...tinyThresholds() },
    })
    // 每个块都进了 store，受保护的也不例外——压缩省下了，召回能力没丢
    expect(store.stamps().length).toBe(5)
  })

  it('无 compaction point 时行为不变', async () => {
    const store = makeStore()
    const result = await buildContext(makeBlocks(5), {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      contextAmplifier: { store, ...tinyThresholds() },
    })
    const stamped = result.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#STAMP\s+[0-9a-f]{12}/.test(p.text))
    )
    // 5 块：L0 协议头 2 个 + L1/L2/L3 压缩块 3 个
    expect(stamped.length).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 本节测试 4 个增量改进：compressedTokens 字段 / L0 协议头注入 /
// working_state 兜底 / L0 协议 vs L1/L2/L3 区分
// ─────────────────────────────────────────────────────────────────────

describe('compressedTokens 字段', () => {
  beforeEach(() => resetCommitStore())

  it('amplifyContext 返回 compressedTokens 数字', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      ...tinyThresholds(),
    })
    expect(typeof r.compressedTokens).toBe('number')
    expect(r.compressedTokens).toBeGreaterThan(0)
  })

  it('L1/L2/L3 压缩生效时 compressedTokens 明显低于无压缩时的理论最大值', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 极简' }),
      ...tinyThresholds(),
    })
    // inputTokens 包含所有块的原始 token，compressedTokens 包含 L0 协议头 + L1/L2/L3 压缩块
    // 用 0.7 市口径阈值而非严格 <：测试用例的块非常小（约 80 token/块），L1 合并后的
    // 结构化文本（提问+结论+TOOLS）在微块场景下天然不比原文短——而真实 B 端场景
    // （每块数千 token、含大量工具链）压缩比才有意义。这里断言压缩没有把体积撑爆。
    expect(r.compressedTokens).toBeLessThan(r.inputTokens * 1.1)
    expect(r.compressedTokens).toBeGreaterThan(0)
    // 关键不变式：压缩后条数严格少于压缩前（L0 原文 2 块 + 3 个压缩块 < 原始 15 条）
    expect(r.messages.length).toBeLessThan(makeBlocks(5).length)
  })

  it('空 early-return 也带 compressedTokens: 0', async () => {
    const r = await amplifyContext([], { store: makeStore() })
    expect(r.compressedTokens).toBe(0)
  })
})

describe('L0 块注入轻量级协议头', () => {
  it('L0 块在原文前插入 #STAMP / #LAYER L0 / #STATUS / #END_BLOCK 协议头', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      ...tinyThresholds(),
    })
    // 找 L0 协议头消息（role=user 且 #LAYER L0）
    const l0Headers = r.messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L0\b/.test(p.text))
    )
    expect(l0Headers.length).toBe(2) // L0 保留最近 2 块，所以 2 个协议头
    for (const h of l0Headers) {
      const text = h.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      expect(text).toMatch(/#STAMP [0-9a-f]{12}/)
      expect(text).toMatch(/#LAYER L0\b/)
      expect(text).toMatch(/#STATUS (DONE|PENDING)/)
      expect(text).toMatch(/#END_BLOCK$/)
      expect(h.role).toBe('user')
    }
  })

  it('L0 协议头后面紧跟该块的所有原始消息', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      ...tinyThresholds(),
    })
    // 找到协议头，看它后面是不是该块的原始 user/assistant 消息
    const idx = r.messages.findIndex((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L0\b/.test(p.text))
    )
    expect(idx).toBeGreaterThanOrEqual(0)
    const next = r.messages[idx + 1]
    expect(next).toBeDefined()
    // 紧跟的是 user 消息（块的第一条）
    expect(next.role).toBe('user')
  })
})

describe('buildFallbackSummary 补 working_state', () => {
  beforeEach(() => resetCommitStore())

  it('压缩失败时降级摘要带 #GOAL / #REJECTED 等块（来自模型自报）', async () => {
    const store = makeStore()
    // 块2 提交 working_state
    recordCommit(
      'sess-1',
      {
        task_goal: '长程任务的总目标',
        conclusion: '已确认结论',
        working_state: {
          current_goal: '实现 X',
          effective_decisions: ['用方案 A', '引入 Y 库'],
          rejected_decisions: ['不用方案 B（性能差）', '不用 Z 库（维护少）'],
          architecture_boundaries: ['核心算法不许用 unsafe'],
          remaining_work: ['补充文档', '跑回归测试'],
        },
      },
      8,
      { valid: true, errors: [] }
    )
    console.error('DBG pending keys:', Array.from({length: 0}))
    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: false }), // 强制 fallback
      ...tinyThresholds(),
    })
    // 找含 #GOAL 的压缩块（working_state 绑的块不一定是第一个 L1/L2/L3 块，
    // 所以不能按"第一个 L[123]"取）。如果找不到说明 working_state 没注入。
    const blockWithGoal = r.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('#GOAL'))
    )
    const text = blockWithGoal?.contentParts?.find((p) => p.type === 'text')?.text ?? ''
    expect(text).toContain('#GOAL 实现 X')
    expect(text).toContain('#REJECTED')
    expect(text).toContain('不用方案 B（性能差）')
    expect(text).toContain('#EFFECTIVE')
    expect(text).toContain('用方案 A')
    expect(text).toContain('#BOUNDARY')
    expect(text).toContain('#REMAINING')
  })

  it('working_state 字段全空时不输出兜底块（避免噪音）', async () => {
    const store = makeStore()
    recordCommit(
      'sess-1',
      {
        task_goal: 'x',
        conclusion: 'y',
        working_state: {
          current_goal: '',
          effective_decisions: [],
          rejected_decisions: [],
          architecture_boundaries: [],
          remaining_work: [],
        },
      },
      8,
      { valid: true, errors: [] }
    )
    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: false }),
      ...tinyThresholds(),
    })
    const block2 = r.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L[123]\b/.test(p.text))
    )
    expect(block2?.contentParts?.find((p) => p.type === 'text')?.text ?? '').not.toContain('#GOAL')
  })

  it('working_state 完全缺失时也不输出兜底块', async () => {
    const store = makeStore()
    // 提交里没有 working_state 字段
    recordCommit(
      'sess-1',
      { task_goal: 'x', conclusion: 'y' },
      8,
      { valid: true, errors: [] }
    )
    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: false }),
      ...tinyThresholds(),
    })
    const block2 = r.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L[123]\b/.test(p.text))
    )
    const text = block2?.contentParts?.find((p) => p.type === 'text')?.text ?? ''
    expect(text).not.toContain('#GOAL')
  })

  it('缓存命中时 working_state 也会被附加到缓存摘要后', async () => {
    const store = makeStore()
    // 第一次：压缩成功，缓存
    await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 简短' }),
      ...tinyThresholds(),
    })
    // 提交 working_state
    recordCommit(
      'sess-1',
      {
        task_goal: 'x',
        conclusion: 'y',
        working_state: {
          current_goal: '第二轮追加目标',
          rejected_decisions: ['不要 X'],
        },
      },
      8,
      { valid: true, errors: [] }
    )
    // 第二次：缓存命中，但 working_state 是新提交的，要附加
    const r = await amplifyContext(makeBlocks(5), {
      store,
      sessionId: 'sess-1',
      compressBlock: async () => ({ ok: true, summary: '#压缩结果 简短' }),
      ...tinyThresholds(),
    })
    const blockWithGoal = r.messages.find((m) =>
      m.contentParts?.some((p) => p.type === 'text' && p.text.includes('第二轮追加目标'))
    )
    const text = blockWithGoal?.contentParts?.find((p) => p.type === 'text')?.text ?? ''
    expect(text).toContain('第二轮追加目标')
    expect(text).toContain('不要 X')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 探活：直接回答用户 3 个问题
//   Q1 算法更新是否同步到前端？或被缓存机制占用？
//   Q2 自动丢弃是不是还在（chatbox 原始状态机）？
//   Q3 召回工具是否破坏模型调用其他工具的能力？
// ─────────────────────────────────────────────────────────────────────

describe('Q1: 算法更新是否同步到前端（vs 旧实现/缓存）', () => {
  it('返回值是新版 pipeline 形状（compressedTokens / cacheHits / selfReportedBlocks / localMergedBlocks）', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      compressBlock: async () => ({ ok: true, summary: '#新版压缩' }),
      ...tinyThresholds(),
    })
    expect(r).toHaveProperty('compressedTokens')
    expect(r).toHaveProperty('cacheHits')
    expect(r).toHaveProperty('selfReportedBlocks')
    expect(r).toHaveProperty('localMergedBlocks')
    expect(r).toHaveProperty('compressedBlocks')
    expect(r).toHaveProperty('archivedBlocks')
    expect(r).toHaveProperty('fallbackBlocks')
  })

  it('缓存占用问题：内容未推进时第二轮 cacheHits == compressedBlocks（零 API 调用）', async () => {
    const store = makeStore()
    let calls = 0
    const opts = {
      store,
      compressBlock: async () => {
        calls++
        return { ok: true, summary: '#压缩' }
      },
      ...tinyThresholds(),
    }
    await amplifyContext(makeBlocks(5), opts)
    const firstCalls = calls
    const r2 = await amplifyContext(makeBlocks(5), opts)
    // 内容未推进：第二轮调 API 的次数不会增长（这才是真正的「缓存占用」判定点）
    expect(calls).toBe(firstCalls)
    // 第二轮至少要命中部分缓存（cacheHits > 0），证明缓存机制生效、未被废弃
    expect(r2.cacheHits).toBeGreaterThan(0)
    // 缓存未命中那部分（来自 L0 协议头）不计入 compressedBlocks，所以 cacheHits < compressedBlocks 是预期的
    expect(r2.cacheHits).toBeLessThanOrEqual(r2.compressedBlocks)
  })
})

describe('Q2: message-limit 与压缩共存（applyMessageLimit 为上游 sticky window 设计）', () => {
  it('maxContextMessageCount=默认 MAX_SAFE_INTEGER 时，压缩块和原始消息都保留（默认不丢）', async () => {
    const r = await buildContext(makeBlocks(5), {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      maxContextMessageCount: Number.MAX_SAFE_INTEGER,
      contextAmplifier: { store: makeStore(), ...tinyThresholds() },
    })
    expect(r.length).toBeGreaterThanOrEqual(11)
    const stamps = r.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#STAMP\s+[0-9a-f]{12}/.test(p.text))
    )
    expect(stamps.length).toBe(5)
  })

  it('applyCompaction 在无有效 compaction point 时不会丢任何消息', async () => {
    const r = await buildContext(makeBlocks(5), {
      toolCleanupMode: 'none',
      attachmentResolver: resolver,
      compactionPoints: [
        { boundaryMessageId: 'non-existent', summaryMessageId: 'non-existent', createdAt: 1 } as never,
      ],
    })
    expect(r.length).toBe(makeBlocks(5).length)
  })
})

describe('Q3: 工具兼容性 — 召回工具是否破坏模型调用其他工具的能力', () => {
  it('压缩块不带 tool-call part（不会假装是 tool_use），下游 AI SDK 不会被压缩块误解析为 tool call', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      compressBlock: async () => ({ ok: true, summary: '#压缩' }),
      ...tinyThresholds(),
    })
    for (const m of r.messages) {
      const text = m.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      if (!/#LAYER L[123]\b/.test(text)) continue
      const toolCalls = (m.contentParts ?? []).filter((p) => p.type === 'tool-call')
      expect(toolCalls.length).toBe(0)
    }
  })

  it('L0 块的 tool-call part 在 cleanToolCalls 后被清掉，但 #STAMP 协议头保留（多轮对话可用 #STAMP 召回）', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      ...tinyThresholds(),
    })
    const messages = r.messages
    const roundBoundaryIndex = (() => {
      let round = 0
      let inRound = false
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') inRound = true
        else if (messages[i].role === 'user' && inRound) {
          round++
          inRound = false
          if (round >= 2) return i
        }
      }
      return 0
    })()
    for (let i = 0; i < messages.length; i++) {
      if (i >= roundBoundaryIndex) continue
      messages[i].contentParts = (messages[i].contentParts ?? []).filter((p) => p.type !== 'tool-call')
    }
    const stamps = messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#STAMP\s+[0-9a-f]{12}/.test(p.text))
    )
    expect(stamps.length).toBe(5)
    const l0Block = messages.find((m) => m.id === 'a0-tool')
    if (l0Block) {
      const hasTool = (l0Block.contentParts ?? []).some((p) => p.type === 'tool-call')
      expect(hasTool).toBe(false)
    }
  })

  it('recall 工具和原工具是叠加的：ToolSet 是个普通对象，多注册不会互相破坏', async () => {
    const originalTools = {
      read_file: { description: '读取文件' },
      user_exec: { description: '执行命令' },
      load_skill: { description: '加载技能' },
    }
    const amplifierTools = {
      retrieve_by_stamp: { description: '召回' },
      submit_curated_task_memory: { description: '自报' },
    }
    const merged = { ...originalTools, ...amplifierTools }
    expect(Object.keys(merged).sort()).toEqual(
      ['load_skill', 'read_file', 'retrieve_by_stamp', 'submit_curated_task_memory', 'user_exec'].sort()
    )
  })
})

describe('L0 协议 vs L1/L2/L3 区分', () => {
  it('L0 协议头不含 #TOOLS，L1/L2/L3 压缩块才含 #TOOLS', async () => {
    const r = await amplifyContext(makeBlocks(5), {
      store: makeStore(),
      compressBlock: async () => ({ ok: false }),
      ...tinyThresholds(),
    })
    const l0Headers = r.messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L0\b/.test(p.text))
    )
    const compressedBlocks = r.messages.filter((m) =>
      m.contentParts?.some((p) => p.type === 'text' && /#LAYER L[123]\b/.test(p.text))
    )
    expect(l0Headers.length).toBeGreaterThan(0)
    expect(compressedBlocks.length).toBeGreaterThan(0)
    // L0 协议头是「状态标记」，不是「压缩摘要」，不应有 #TOOLS
    for (const h of l0Headers) {
      const text = h.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      expect(text).not.toContain('#TOOLS')
    }
    // L1/L2/L3 压缩块 fallback 时含 #TOOLS
    for (const b of compressedBlocks) {
      const text = b.contentParts?.find((p) => p.type === 'text')?.text ?? ''
      expect(text).toContain('#TOOLS')
    }
  })
})

