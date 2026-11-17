import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { rowChatFixture } from '../chat/testing/row-chat-fixture'
import { GenerationSegmentTransitions } from '../../generation/GenerationSegmentTransitions'
import type { Message, Session } from '../../types'
import { createGenerationSegmentSplitWriter, type GenerationSegmentSplit } from './generation-segment-split'
import { StreamingWriteCoordinator } from './streaming-write-coordinator'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const text = (value: string): Message['contentParts'] => [{ type: 'text', text: value }]
const original = (): Message => ({
  id: 'assistant',
  role: 'assistant',
  generating: true,
  contentParts: text('old + recent'),
})
const split = (): GenerationSegmentSplit => ({
  prefix: { ...original(), generating: false, finishReason: 'compacted', contentParts: text('old') },
  continuation: { id: 'tail', role: 'assistant', generating: true, contentParts: text('recent') },
  afterMessageId: 'assistant',
})
const initial = (): Session => ({ id: 'session', name: 'test', type: 'chat', messages: [original()] })

function harness(input = initial()) {
  const fixture = rowChatFixture(() => 'unused', input)
  let before: Promise<void> | undefined
  let during: Promise<void> | undefined
  let failure: 'before' | 'metadata' | undefined
  let writes = 0
  const apply = fixture.rows.applyDiff.bind(fixture.rows)
  vi.spyOn(fixture.rows, 'applyDiff').mockImplementation(async (...args) => {
    await during
    if (failure === 'before') throw new Error('disk write failed')
    const result = await apply(...args)
    writes += 1
    return result
  })
  const streamingWrites = new StreamingWriteCoordinator()
  const sessions: Parameters<typeof createGenerationSegmentSplitWriter>[0]['sessions'] = {
    async executeStructureCommand(id, operation, onCommitted) {
      await before
      const result = await fixture.port.executeStructureCommand(id, operation, onCommitted)
      if (failure === 'metadata') throw new Error('metadata failed after commit')
      return result
    },
  }
  const write = createGenerationSegmentSplitWriter({ sessions, streamingWrites })
  return {
    write,
    streamingWrites,
    fixture,
    get session() {
      return fixture.sessions.get('session')!
    },
    get writes() {
      return writes
    },
    setFailure(value: typeof failure) {
      failure = value
    },
    waitBefore(value: Promise<void>) {
      before = value
    },
    waitDuring(value: Promise<void>) {
      during = value
    },
  }
}

describe('atomic generation segment split', () => {
  it('commits both halves in one durable session write', async () => {
    const h = harness()
    assert.equal(await h.write('session', split(), new AbortController().signal), true)
    assert.equal(h.writes, 1)
    assert.deepEqual(
      h.session.messages.map((message) => [message.id, message.generating, message.contentParts]),
      [
        ['assistant', false, text('old')],
        ['tail', true, text('recent')],
      ]
    )
  })

  it('leaves neither a half-prefix nor an orphan continuation on storage failure', async () => {
    const h = harness()
    const snapshot = structuredClone(h.session)
    h.setFailure('before')
    await assert.rejects(h.write('session', split(), new AbortController().signal), /disk write failed/)
    assert.deepEqual(h.session, snapshot)
    assert.equal(h.session.messages.length, 1)
  })

  it('recognizes a durable split despite metadata failure and permits ownership transfer', async () => {
    const h = harness()
    h.setFailure('metadata')
    assert.equal(await h.write('session', split(), new AbortController().signal), true)
    assert.equal(h.session.messages[0].generating, false)
    assert.equal(h.session.messages[1].id, 'tail')
  })

  it('rechecks cancellation inside the session coordinator update', async () => {
    const h = harness()
    const barrier = deferred()
    h.waitBefore(barrier.promise)
    const abort = new AbortController()
    const pending = h.write('session', split(), abort.signal)
    abort.abort()
    barrier.resolve()
    assert.equal(await pending, false)
    assert.equal(h.session.messages.length, 1)
  })

  it('settles and finalizes the continuation when Stop arrives during durable I/O', async () => {
    const h = harness()
    const barrier = deferred()
    h.waitDuring(barrier.promise)
    const abort = new AbortController()
    const transitions = new GenerationSegmentTransitions(abort.signal)
    let target = 'assistant'
    const pending = transitions.run(
      () => h.write('session', split(), abort.signal),
      () => {
        target = 'tail'
      }
    )
    // Let the transaction produce its snapshot, then stop while it is writing.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    abort.abort()
    const stop = transitions.settle().then(() => {
      const message = h.session.messages.find((candidate) => candidate.id === target)
      assert.ok(message)
      message.generating = false
      message.finishReason = 'canceled'
    })
    barrier.resolve()
    assert.equal(await pending, true)
    await stop
    assert.equal(target, 'tail')
    assert.equal(h.session.messages.filter((message) => message.generating).length, 0)
    assert.deepEqual(
      h.session.messages.map((message) => message.contentParts),
      [text('old'), text('recent')]
    )
  })

  it('drains the old streaming checkpoint before committing the split', async () => {
    const h = harness()
    const barrier = deferred()
    const events: string[] = []
    const checkpoint = h.streamingWrites.scheduleCheckpoint('session\u0000assistant', async () => {
      events.push('checkpoint started')
      await barrier.promise
      events.push('checkpoint finished')
    })
    const pending = h.write('session', split(), new AbortController().signal).then((result) => {
      events.push('split committed')
      return result
    })
    await Promise.resolve()
    assert.equal(h.writes, 0)
    barrier.resolve()
    await checkpoint
    assert.equal(await pending, true)
    assert.deepEqual(events, ['checkpoint started', 'checkpoint finished', 'split committed'])
  })

  it('declines when an already-running Stop terminal write owns the old key', async () => {
    const h = harness()
    const barrier = deferred()
    const stop = h.streamingWrites.persistTerminal('session\u0000assistant', () => barrier.promise)
    const pending = h.write('session', split(), new AbortController().signal)
    barrier.resolve()
    await stop
    assert.equal(await pending, false)
    assert.equal(h.writes, 0)
  })

  it('does not resurrect a target already finalized by Stop', async () => {
    const source = initial()
    source.messages[0].generating = false
    const h = harness(source)
    assert.equal(await h.write('session', split(), new AbortController().signal), false)
    assert.equal(h.writes, 0)
  })

  it('is idempotent and does not mutate the caller input', async () => {
    const source = initial()
    const before = structuredClone(source)
    const h = harness(source)
    assert.equal(await h.write('session', split(), new AbortController().signal), true)
    const result = await h.fixture.port.executeStructureCommand('session', {
      action: 'generation-segment-split',
      ...split(),
    })
    assert.equal(result?.applied, true)
    assert.equal(h.writes, 1)
    assert.deepEqual(source, before)
    const rows = await h.fixture.repository.readSessionMessages({ sessionId: 'session', messageIds: ['assistant'] })
    assert.equal(rows?.messages[0].generating, false)
    assert.equal(
      h.fixture.rows.snapshot()[0].rows.messages.find((row) => row.messageId === 'assistant')?.status,
      'settled'
    )
  })

  it('supports steered user anchors and preserves their causal order', async () => {
    const source = initial()
    source.messages.push({ id: 'steer', role: 'user', contentParts: text('continue differently') })
    const h = harness(source)
    await h.write('session', { ...split(), afterMessageId: 'steer' }, new AbortController().signal)
    assert.deepEqual(
      h.session.messages.map((message) => message.id),
      ['assistant', 'steer', 'tail']
    )
  })

  it('updates an archived thread without touching the current thread', async () => {
    const h = harness({
      ...initial(),
      messages: [],
      threads: [{ id: 'thread', name: 'archived', createdAt: 0, messages: [original()] }],
    })
    await h.write('session', split(), new AbortController().signal)
    assert.deepEqual(h.session.messages, [])
    assert.deepEqual(
      h.session.threads?.[0].messages.map((message) => message.id),
      ['assistant', 'tail']
    )
  })

  it('updates a saved fork without inserting into another branch', async () => {
    const h = harness({
      ...initial(),
      messages: [{ id: 'pivot', role: 'user', contentParts: text('question') }],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 0,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved', messages: [original()] },
          ],
        },
      },
    })
    await h.write('session', split(), new AbortController().signal)
    assert.deepEqual(
      h.session.messages.map((message) => message.id),
      ['pivot']
    )
    assert.deepEqual(
      h.session.messageForksHash?.pivot.lists
        .find((branch) => branch.id === 'saved')
        ?.messages.map((message) => message.id),
      ['assistant', 'tail']
    )
  })

  it('rejects missing or cross-path anchors without partial updates', async () => {
    const h = harness()
    await assert.rejects(
      h.write('session', { ...split(), afterMessageId: 'missing' }, new AbortController().signal),
      /outside the target path/
    )
    assert.equal(h.session.messages.length, 1)
    assert.equal(h.session.messages[0].generating, true)
    assert.equal(h.writes, 0)
  })
})
