import assert from 'node:assert/strict'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import { describe, it } from 'vitest'
import { MidRunCompactionController } from './MidRunCompactionController'
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

function harness(threshold = 57_600) {
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
  let fail: 'throw' | 'false' | 'boundary' | 'busy' | 'backup_busy' | 'stale_path' | undefined
  let declineSplit = false
  const controller = new MidRunCompactionController({
    thresholdTokens: threshold,
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
      if (fail === 'busy' || fail === 'backup_busy' || fail === 'stale_path') return { status: 'skipped', reason: fail }
      if (fail === 'throw') throw new Error('summary unavailable')
      if (fail === 'false')
        return { status: 'failed', failure: { code: 'summary_failed', message: 'summary unavailable' } }
      return {
        status: 'compacted',
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

  for (const reason of ['busy', 'backup_busy'] as const) {
    it(`keeps later compaction available after ${reason}`, async () => {
      const h = harness(200)
      h.source[1] = { role: 'user', content: 'history '.repeat(1000) }
      h.append('current-tool', 10)
      h.setFailure(reason)
      assert.equal(await h.controller.prepareStep(h.source, 1), h.source)
      h.setFailure(undefined)
      const rewritten = await h.controller.prepareStep(h.source, 2)
      assert.equal(h.compactions, 2)
      assert.equal(rewritten[1].content, 'summary-2')
    })
  }

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
        assert.equal(effective[1].content, 'summary-1')
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
      thresholdTokens: null,
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
})
