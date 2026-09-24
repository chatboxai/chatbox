import { describe, expect, it } from 'vitest'
import type { StampStoreLike } from './pipeline'
import { PROJECTION_TOKEN_LIMIT, projectToolResults, stampOfToolResult } from './projection'
import sha256Cjs from './sha256.js'
import { StampStore } from './stamp-store.js'

const { sha256Hex } = sha256Cjs as unknown as { sha256Hex: (s: string) => string }

function makeMsg(id: string, parts: unknown[]) {
  return { id, role: 'assistant', contentParts: parts } as never
}

// 混合内容构造超预算文本：避免单字符长 run 触发 tokenizer 病态慢路径
const bigResult = Array.from({ length: 60_000 }, (_, i) => `chunk-${i}-xxxxxxxx`).join(' ')

describe('projectToolResults (ADR-036 bounded projection)', () => {
  it('未超预算的工具结果原样保留', () => {
    const store = new StampStore()
    const msgs = [
      makeMsg('m1', [{ type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'read', result: 'small' }]),
    ]
    const out = projectToolResults(msgs, { store: store as unknown as StampStoreLike })
    expect(out).toEqual(msgs)
    expect(store.size).toBe(0)
  })

  it('超预算结果被投影：含 [tool-result-projection] 与 #STAMP 12位戳，且保头保尾', () => {
    const store = new StampStore()
    const msgs = [
      makeMsg('m1', [{ type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'read', result: bigResult }]),
    ]
    const out = projectToolResults(msgs, { store: store as unknown as StampStoreLike })
    const part = (out[0] as { contentParts: Array<{ result?: string }> }).contentParts[0]
    expect(part.result).toContain('[tool-result-projection]')
    expect(part.result).toMatch(/#STAMP [0-9a-f]{12}\b/)
    expect(part.result!.startsWith('chunk-0-')).toBe(true)
    expect(part.result!.endsWith('-xxxxxxxx')).toBe(true)
  })

  it('戳算法与 agent-shell stampOfToolTurn 同构：sha256(toolCallId:toolName:content[:100]) 前12位', () => {
    expect(stampOfToolResult('t1', 'read', 'hello')).toBe(sha256Hex('t1:read:hello').slice(0, 12))
  })

  it('全文进 store，layer=PROJECTED，可按戳取回', () => {
    const store = new StampStore()
    const msgs = [
      makeMsg('m1', [{ type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'read', result: bigResult }]),
    ]
    const out = projectToolResults(msgs, { store: store as unknown as StampStoreLike })
    const stamp = /#STAMP ([0-9a-f]{12})/.exec(
      (out[0] as { contentParts: Array<{ result?: string }> }).contentParts[0].result!
    )![1]
    const entry = store.get(stamp) as { meta: { layer?: string }; fullMessages: Array<{ content: string }> } | null
    expect(entry).not.toBeNull()
    expect(entry!.meta.layer).toBe('PROJECTED')
    expect(entry!.fullMessages[0].content).toBe(bigResult)
  })

  it('幂等：已投影结果不再二次投影（戳不漂移，store 不膨胀）', () => {
    const store = new StampStore()
    const msgs = [
      makeMsg('m1', [{ type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'read', result: bigResult }]),
    ]
    const once = projectToolResults(msgs, { store: store as unknown as StampStoreLike })
    const twice = projectToolResults(once, { store: store as unknown as StampStoreLike })
    expect(twice).toEqual(once)
    expect(store.size).toBe(1)
  })

  it('非 result 状态与文本 part 不受影响', () => {
    const store = new StampStore()
    const msgs = [
      makeMsg('m1', [
        { type: 'tool-call', state: 'call', toolCallId: 't1', toolName: 'read', args: {} },
        { type: 'text', text: 'x'.repeat(999_999) },
      ]),
    ]
    const out = projectToolResults(msgs, { store: store as unknown as StampStoreLike })
    expect(out).toEqual(msgs)
    expect(store.size).toBe(0)
  })
})
