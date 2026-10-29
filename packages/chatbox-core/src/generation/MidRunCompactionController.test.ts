import assert from 'node:assert/strict'
import { buildCompactionHandoff } from '@shared/context/compaction-handoff'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import { describe, it } from 'vitest'
import { getCompactionBudget } from '../application/token-estimation/math'
import { MidRunCompactionController, type MidRunCompactionOptions } from './MidRunCompactionController'
import { collectToolCallIds, estimateModelMessagesTokens } from './mid-run-compaction'

function round(id: string, chars = 20_000): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'read_file', input: {} }] },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: id,
          toolName: 'read_file',
          output: { type: 'text', value: 'x'.repeat(chars) },
        },
      ],
    },
  ]
}

/** A 100K window: 25.6K reply reservation, 76.8K usable, compaction above 57.6K. */
function harness(contextWindow = 102_400, language?: string, extra: Partial<MidRunCompactionOptions> = {}) {
  const abort = new AbortController()
  const source: ModelMessage[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'task' },
  ]
  let parts: MessageContentParts = []
  let currentId = 'assistant-0'
  let prefixId = ''
  let compactions = 0
  let splitCount = 0
  let fail: 'throw' | 'false' | 'boundary' | 'busy' | 'stale_path' | undefined
  let declineSplit = false
  const controller = new MidRunCompactionController({
    budget: getCompactionBudget(contextWindow),
    ...extra,
    language,
    signal: abort.signal,
    getTargetMessageId: () => currentId,
    getContentParts: () => parts,
    splitPrefix: async (prefix, tail) => {
      if (declineSplit) return false
      assert.ok(prefix.length)
      assert.ok(tail.length)
      prefixId = currentId
      currentId = `assistant-${++splitCount}`
      parts = tail
      return true
    },
    compact: async (request) => {
      compactions += 1
      if (fail === 'busy' || fail === 'stale_path') return { status: 'skipped', reason: fail }
      if (fail === 'throw') throw new Error('summary unavailable')
      if (fail === 'false')
        return { status: 'failed', failure: { code: 'summary_failed', message: 'summary unavailable' } }
      return {
        status: 'compacted',
        revision: 1,
        summaryMessageId: `summary-${compactions}`,
        summary: `summary-${compactions}`,
        coverage: {
          ...request,
          retainedToolCallId: fail === 'boundary' ? 'wrong' : request.retainedToolCallId,
          boundaryMessageId: prefixId || 'user',
        },
      }
    },
  })
  return {
    controller,
    abort,
    source,
    get compactions() {
      return compactions
    },
    get splitCount() {
      return splitCount
    },
    setFailure(value: typeof fail) {
      fail = value
    },
    decline() {
      declineSplit = true
    },
    append(id: string, chars?: number) {
      source.push(...round(id, chars))
      parts.push({
        type: 'tool-call',
        state: 'result',
        toolCallId: id,
        toolName: 'read_file',
        args: {},
        result: 'done',
      })
    },
  }
}

describe('MidRunCompactionController', () => {
  it('rejects a mismatched coverage receipt even when every current tool call stays in the tail', async () => {
    const h = harness(200)
    h.source[1] = { role: 'user', content: 'history '.repeat(1000) }
    h.append('current-tool', 10)
    h.setFailure('boundary')
    assert.equal(await h.controller.prepareStep(h.source, 1), h.source)
    assert.equal(h.splitCount, 0)
    assert.equal(h.compactions, 1)
  })

  for (const reason of ['busy'] as const) {
    it(`keeps later compaction available after ${reason}`, async () => {
      const h = harness(200)
      h.source[1] = { role: 'user', content: 'history '.repeat(1000) }
      h.append('current-tool', 10)
      h.setFailure(reason)
      assert.equal(await h.controller.prepareStep(h.source, 1), h.source)
      h.setFailure(undefined)
      const rewritten = await h.controller.prepareStep(h.source, 2)
      assert.equal(h.compactions, 2)
      assert.deepEqual(rewritten[1], { role: 'user', content: buildCompactionHandoff('summary-2', 'resume').text })
    })
  }

  it('resumes the task in the session language before the retained tool rounds', async () => {
    const h = harness(200, 'zh-Hans')
    h.source[1] = { role: 'user', content: 'history '.repeat(1000) }
    h.append('current-tool', 10)
    const rewritten = await h.controller.prepareStep(h.source, 1)
    assert.deepEqual(
      rewritten.map((message) => message.role),
      ['system', 'user', 'assistant', 'tool']
    )
    assert.deepEqual(rewritten[1], {
      role: 'user',
      content: buildCompactionHandoff('summary-1', 'resume', 'zh-Hans').text,
    })
    assert.match(String(rewritten[1].content), /继续完成尚未完成的任务/)
  })

  it('stops planning after the generation path becomes stale', async () => {
    const h = harness(200)
    h.source[1] = { role: 'user', content: 'history '.repeat(1000) }
    h.append('current-tool', 10)
    h.setFailure('stale_path')
    await h.controller.prepareStep(h.source, 1)
    await h.controller.prepareStep(h.source, 2)
    assert.equal(h.compactions, 1)
  })

  it('recompacts a growing 64-step run instead of making success terminal', async () => {
    const h = harness()
    const measurements: number[] = []
    for (let step = 1; step <= 64; step += 1) {
      h.append(`t${step}`)
      const effective = await h.controller.prepareStep(h.source, step)
      const tokens = estimateModelMessagesTokens(effective)
      measurements.push(tokens)
      assert.ok(tokens <= 57_600, `step ${step} grew to ${tokens} tokens`)
      assert.ok(collectToolCallIds(effective).has(`t${step}`), 'the newest result must survive')
    }
    assert.ok(h.compactions >= 3, `only compacted ${h.compactions} time(s)`)
    assert.equal(h.splitCount, h.compactions)
  })

  for (const failure of ['throw', 'false', 'boundary'] as const) {
    it(`retains the last successful rewrite after a later ${failure} failure`, async () => {
      const h = harness()
      let effective: ModelMessage[] = []
      for (let step = 1; step <= 12; step += 1) {
        h.append(`t${step}`)
        effective = await h.controller.prepareStep(h.source, step)
      }
      assert.equal(h.compactions, 1)
      assert.ok(!collectToolCallIds(effective).has('t1'))
      h.setFailure(failure)
      for (let step = 13; step <= 40; step += 1) {
        h.append(`t${step}`)
        effective = await h.controller.prepareStep(h.source, step)
        assert.ok(!collectToolCallIds(effective).has('t1'), 'must not resurrect the raw prefix')
        assert.deepEqual(effective[1], { role: 'user', content: buildCompactionHandoff('summary-1', 'resume').text })
      }
      assert.equal(h.compactions, 2, 'do not retry a failing summarizer every step')
    })
  }

  it('does not summarize or discard a prefix when its atomic split was declined', async () => {
    const h = harness()
    h.decline()
    for (let step = 1; step <= 12; step += 1) h.append(`t${step}`)
    assert.equal(await h.controller.prepareStep(h.source, 12), h.source)
    assert.equal(h.compactions, 0)
  })

  it('uses tool identity after an earlier synthetic image disappears', async () => {
    const h = harness()
    h.source.splice(2, 0, {
      role: 'user',
      content: [
        { type: 'text', text: '[Image from view_image tool: old.png]' },
        { type: 'image', image: 'bytes' },
      ],
    })
    for (let step = 1; step <= 12; step += 1) h.append(`t${step}`)
    const first = await h.controller.prepareStep(h.source, 12)
    h.source.splice(2, 1)
    const second = await h.controller.prepareStep(h.source, 13)
    assert.deepEqual(second, first)
    assert.equal(h.compactions, 1)
    assert.equal(second[2].role, 'assistant')
  })

  it('does not attempt compaction after cancellation', async () => {
    const h = harness()
    for (let step = 1; step <= 12; step += 1) h.append(`t${step}`)
    h.abort.abort()
    assert.equal(await h.controller.prepareStep(h.source, 12), h.source)
    assert.equal(h.compactions, 0)
    assert.equal(h.splitCount, 0)
  })

  it('does not compact the first provider request or a disabled run', async () => {
    const h = harness()
    for (let step = 1; step <= 12; step += 1) h.append(`t${step}`)
    assert.equal(await h.controller.prepareStep(h.source, 0), h.source)
    assert.equal(h.compactions, 0)
    const disabled = new MidRunCompactionController({
      budget: null,
      signal: h.abort.signal,
      getTargetMessageId: () => 'assistant',
      getContentParts: () => [],
      splitPrefix: async () => {
        throw new Error('must not split')
      },
      compact: async () => {
        throw new Error('must not compact')
      },
    })
    assert.equal(await disabled.prepareStep(h.source, 1), h.source)
  })

  it('waits for growth when fixed content keeps a compacted request above the threshold', async () => {
    const headroom: Array<{ tokens: number; thresholdTokens: number }> = []
    // 16K window: 12,288 usable, threshold 9,216, 1,843 growth between compactions.
    const h = harness(16_384, undefined, { onInsufficientHeadroom: (info) => headroom.push(info) })
    h.source[0] = { role: 'system', content: 'x'.repeat(37_000) }
    for (let step = 1; step <= 20; step += 1) {
      h.append(`t${step}`, 2_000)
      const effective = await h.controller.prepareStep(h.source, step)
      assert.ok(collectToolCallIds(effective).has(`t${step}`), 'the newest result must survive')
    }
    assert.ok(headroom.length > 0 && headroom.every((info) => info.tokens > info.thresholdTokens))
    // Each round adds ~500 tokens, so a compaction waits about four rounds instead of running every step.
    assert.ok(h.compactions >= 3 && h.compactions <= 6, `compacted ${h.compactions} times in 20 steps`)
  })

  it('counts request overhead such as tool definitions toward the threshold', async () => {
    const withoutOverhead = harness(16_384)
    const withOverhead = harness(16_384, undefined, { getRequestOverheadTokens: async () => 6_000 })
    for (const h of [withoutOverhead, withOverhead]) {
      for (let step = 1; step <= 6; step += 1) h.append(`t${step}`, 2_000)
      await h.controller.prepareStep(h.source, 6)
    }
    assert.equal(withoutOverhead.compactions, 0)
    assert.equal(withOverhead.compactions, 1)
  })

  it('retains more of the recent run when a compaction has room below its target', async () => {
    const h = harness(16_384)
    for (let step = 1; step <= 20; step += 1) h.append(`t${step}`, 2_000)
    const effective = await h.controller.prepareStep(h.source, 20)
    assert.equal(h.compactions, 1)
    // Target 6,144 less the 1,228 summary allowance leaves room for nine ~510-token rounds.
    assert.ok(collectToolCallIds(effective).size >= 8, `kept ${collectToolCallIds(effective).size} rounds`)
    assert.ok(estimateModelMessagesTokens(effective) <= getCompactionBudget(16_384)!.targetTokens)
  })

  it('leaves the request below a low threshold instead of compacting to half the usable window', async () => {
    const headroom: Array<{ tokens: number; thresholdTokens: number }> = []
    const budget = getCompactionBudget(16_384, { compactionThreshold: 0.4 })!
    const h = harness(16_384, undefined, { budget, onInsufficientHeadroom: (info) => headroom.push(info) })
    for (let step = 1; step <= 12; step += 1) h.append(`t${step}`, 2_000)
    const effective = await h.controller.prepareStep(h.source, 12)
    assert.equal(h.compactions, 1)
    // Half the usable window (6,144) would sit above the 4,915 trigger; the target follows the threshold down.
    assert.ok(estimateModelMessagesTokens(effective) <= (budget.thresholdTokens * 2) / 3)
    assert.deepEqual(headroom, [])
  })
})
