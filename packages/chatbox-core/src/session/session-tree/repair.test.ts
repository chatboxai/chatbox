import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { decodeSessionTree } from './decode'
import { repairSessionV1 } from './repair'
import { verifySessionTreeRoundTrip } from './verify'

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text: id }], ...overrides }
}

function makeSession(overrides: Partial<Session>): Session {
  return { id: 'session-1', name: 'Session', messages: [], ...overrides }
}

function encodes(session: Session) {
  const result = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: 0 })
  if (!result.ok) throw new Error(result.reason)
  return result
}

describe('repairSessionV1', () => {
  test('returns the input when nothing needs repair', () => {
    const session = makeSession({ messages: [message('u1')] })
    expect(repairSessionV1(session)).toBe(session)
  })

  test('gives archived threads a name and an id distinct from the session and each other', () => {
    const session = makeSession({
      messages: [message('u1')],
      threads: [
        { id: 'session-1', name: null as unknown as string, createdAt: 1, messages: [message('a')] },
        { id: 't', name: 'First', createdAt: 2, messages: [message('b')] },
        { id: 't', name: 'Second', createdAt: 3, messages: [message('c')] },
      ],
    })
    const repaired = repairSessionV1(session)
    expect(repaired.threads?.map((thread) => [thread.id, thread.name])).toEqual([
      ['session-1~thread', ''],
      ['t', 'First'],
      ['t~thread', 'Second'],
    ])
    encodes(session)
  })

  test('renames later duplicate and missing message ids and moves compaction points with the renamed copy', () => {
    const session = makeSession({
      messages: [message('boundary'), message('summary', { isSummary: true }), message('tail')],
      compactionPoints: [{ summaryMessageId: 'summary', boundaryMessageId: 'boundary', createdAt: 1 }],
      threads: [
        {
          id: 'archived',
          name: 'Archived',
          createdAt: 1,
          messages: [message('boundary'), message('summary', { isSummary: true }), message('')],
          compactionPoints: [{ summaryMessageId: 'summary', boundaryMessageId: 'boundary', createdAt: 1 }],
        },
      ],
    })
    const repaired = repairSessionV1(session)
    expect(repaired.threads?.[0].messages.map((item) => item.id)).toEqual([
      'boundary~dup',
      'summary~dup',
      'session-1~message',
    ])
    expect(repaired.threads?.[0].compactionPoints).toEqual([
      { summaryMessageId: 'summary~dup', boundaryMessageId: 'boundary~dup', createdAt: 1 },
    ])
    expect(repaired.compactionPoints).toEqual(session.compactionPoints)
    expect(repairSessionV1(session)).toEqual(repaired)
    encodes(session)
  })

  test('repairs fork positions, placeholders and creation times', () => {
    const session = makeSession({
      messages: [message('u1'), message('a1', { role: 'assistant' })],
      messageForksHash: {
        u1: {
          position: 9,
          createdAt: undefined as unknown as number,
          lists: [{ id: 'saved', messages: [message('alt', { role: 'assistant' })] }],
        },
        a1: {
          position: 0,
          createdAt: 2,
          lists: [
            { id: 'active', messages: [message('stranded')] },
            { id: 'other', messages: [message('other')] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(repaired.messageForksHash?.u1).toEqual({
      position: 1,
      createdAt: 0,
      lists: [
        { id: 'saved', messages: [message('alt', { role: 'assistant' })] },
        { id: 'u1~active', messages: [] },
      ],
    })
    expect(repaired.messageForksHash?.a1.lists).toEqual([
      { id: 'active', messages: [] },
      { id: 'other', messages: [message('other')] },
      { id: 'a1~residual', messages: [message('stranded')] },
    ])
    encodes(session)
  })

  test('keeps the inline copy of an id that a placeholder message repeats', () => {
    const session = makeSession({
      messages: [message('u'), message('a', { role: 'assistant' })],
      messageForksHash: {
        u: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'placeholder', messages: [message('q', { contentParts: [{ type: 'text', text: 'hidden' }] })] },
            { id: 'saved', messages: [message('q', { contentParts: [{ type: 'text', text: 'shown' }] })] },
          ],
        },
        q: {
          position: 1,
          createdAt: 2,
          lists: [
            { id: 'reply', messages: [message('r', { role: 'assistant' })] },
            { id: 'active', messages: [] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(repaired.messageForksHash?.u.lists.map((list) => list.messages.map((item) => item.id))).toEqual([
      [],
      ['q'],
      ['q~dup'],
    ])
    expect(repaired.messageForksHash?.u.lists[1].messages[0].contentParts).toEqual([{ type: 'text', text: 'shown' }])
    expect(repaired.messageForksHash?.u.lists[2].messages[0].contentParts).toEqual([{ type: 'text', text: 'hidden' }])
    expect(repaired.messageForksHash?.q.lists[0].messages.map((item) => item.id)).toEqual(['r'])
    const decoded = decodeSessionTree(encodes(session).tree)
    expect(decoded.ok && JSON.stringify(decoded.session)).toContain('"id":"r"')
  })

  test('moves the fork of a branch point without an id to its derived id', () => {
    const session = makeSession({
      messages: [message(''), message('a', { role: 'assistant' })],
      messageForksHash: {
        '': {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'saved', messages: [message('b', { role: 'assistant' })] },
            { id: 'active', messages: [] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(repaired.messages.map((item) => item.id)).toEqual(['session-1~message', 'a'])
    expect(Object.keys(repaired.messageForksHash ?? {})).toEqual(['session-1~message'])
    const decoded = decodeSessionTree(encodes(session).tree)
    expect(decoded.ok && JSON.stringify(decoded.session)).toContain('"id":"b"')
  })

  test('replaces a fork without lists when a summary fork moves onto its message', () => {
    const session = makeSession({
      messages: [message('u'), message('s1', { isSummary: true }), message('a', { role: 'assistant' })],
      messageForksHash: {
        u: { position: 0, createdAt: 1, lists: [] },
        s1: {
          position: 1,
          createdAt: 2,
          lists: [
            { id: 'saved', messages: [message('b')] },
            { id: 'active', messages: [] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(repaired.messageForksHash?.u).toEqual(session.messageForksHash?.s1)
    expect(repairSessionV1(repaired)).toBe(repaired)
    const decoded = decodeSessionTree(encodes(session).tree)
    expect(decoded.ok && JSON.stringify(decoded.session)).toContain('"id":"b"')
  })

  test('moves a summary fork onto the preceding message and merges it with that message fork', () => {
    const session = makeSession({
      messages: [message('u1'), message('s1', { isSummary: true }), message('a1', { role: 'assistant' })],
      messageForksHash: {
        u1: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'u1-saved', messages: [message('x')] },
            { id: 'u1-active', messages: [] },
          ],
        },
        s1: {
          position: 0,
          createdAt: 2,
          lists: [
            { id: 's1-active', messages: [] },
            { id: 's1-saved', messages: [message('y')] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(Object.keys(repaired.messageForksHash ?? {})).toEqual(['u1'])
    expect(repaired.messageForksHash?.u1).toMatchObject({
      position: 1,
      lists: [{ id: 'u1-saved' }, { id: 'u1-active' }, { id: 's1-saved' }],
    })
    encodes(session)
  })

  test('anchors a summary fork that has no message before it on an empty system message', () => {
    const session = makeSession({
      messages: [message('u1')],
      messageForksHash: {
        u1: {
          position: 1,
          createdAt: 1,
          lists: [
            { id: 'saved', messages: [message('s1', { isSummary: true }), message('b')] },
            { id: 'active', messages: [] },
          ],
        },
        s1: {
          position: 1,
          createdAt: 2,
          lists: [
            { id: 'nested', messages: [message('c')] },
            { id: 'placeholder', messages: [] },
          ],
        },
      },
    })
    const repaired = repairSessionV1(session)
    expect(repaired.messageForksHash?.u1.lists[0].messages.map((item) => item.id)).toEqual(['s1~anchor', 's1', 'b'])
    expect(repaired.messageForksHash?.u1.lists[0].messages[0]).toEqual({
      id: 's1~anchor',
      role: 'system',
      contentParts: [],
    })
    expect(repaired.messageForksHash?.['s1~anchor']).toMatchObject({ lists: [{ id: 'nested' }, { id: 'placeholder' }] })
    encodes(session)
  })

  describe('randomly damaged sessions', () => {
    // Generates V1 sessions with the shapes released clients could leave behind.
    function createDamagedSession(seed: number): Session {
      let state = seed
      const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648
        return state / 2147483648
      }
      const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)]
      let next = 0
      const created: Message[] = []
      const create = (): Message => {
        const id = `m${next++}`
        const item = message(id, {
          role: pick(['user', 'assistant'] as const),
          ...(random() < 0.12 ? { isSummary: true } : {}),
        })
        created.push(item)
        return item
      }
      const chain = (length: number) => Array.from({ length }, create)
      const session = makeSession({ messages: chain(Math.floor(random() * 7)) })
      if (random() < 0.4) {
        session.threads = Array.from({ length: 1 + Math.floor(random() * 2) }, (_, index) => ({
          id: random() < 0.15 ? session.id : random() < 0.1 ? 't0' : `t${index}`,
          name: (random() < 0.1 ? null : 'Thread') as string,
          createdAt: 1,
          messages: chain(Math.floor(random() * 4)),
        }))
      }
      const forks: NonNullable<Session['messageForksHash']> = {}
      for (let attempt = Math.floor(random() * 5); attempt > 0; attempt -= 1) {
        const containers = [
          session.messages,
          ...(session.threads ?? []).map((thread) => thread.messages),
          ...Object.values(forks).flatMap((fork) => fork.lists.map((list) => list.messages)),
        ].filter((container) => container.length > 0)
        if (!containers.length) break
        const pivot = pick(pick(containers))
        if (forks[pivot.id]) continue
        const lists = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
          id: `l${next++}`,
          messages: chain(Math.floor(random() * 3)),
        }))
        let position = Math.floor(random() * (lists.length + 1))
        if (position === lists.length) lists.push({ id: `l${next++}`, messages: [] })
        if (random() > 0.15) lists[position].messages = []
        if (random() < 0.1) position = lists.length + 2
        if (random() < 0.08) pivot.id = ''
        forks[random() < 0.1 ? `deleted${attempt}` : pivot.id] = {
          position,
          createdAt: (random() < 0.1 ? undefined : 1) as number,
          lists: random() < 0.08 ? [] : lists,
        }
      }
      if (Object.keys(forks).length) session.messageForksHash = forks
      for (let duplicate = 0; duplicate < 2; duplicate += 1) {
        if (random() < 0.2 && created.length > 1) pick(created).id = pick(created).id
      }
      if (random() < 0.05 && created.length) pick(created).id = ''
      if (random() < 0.3 && created.length > 1) {
        session.compactionPoints = [
          { summaryMessageId: pick(created).id, boundaryMessageId: pick(created).id, createdAt: 1 },
        ]
      }
      return structuredClone(session)
    }

    // Texts a released client displays: every thread and every list of a reachable pivot, which
    // releases up to 1.22.1 show when a fork is expanded.
    function displayedTexts(session: Session): string[] {
      const forks = session.messageForksHash ?? {}
      const queue = [session.messages, ...(session.threads ?? []).map((thread) => thread.messages)]
      const pivots = new Set<string>()
      const texts: string[] = []
      while (queue.length) {
        for (const item of queue.shift() ?? []) {
          const part = item.contentParts[0]
          texts.push(part?.type === 'text' ? part.text : '')
          const fork = forks[item.id]
          if (!fork || pivots.has(item.id)) continue
          pivots.add(item.id)
          for (const list of fork.lists) queue.push(list.messages)
        }
      }
      return texts
    }

    test('encode and preserve every reachable displayed message', () => {
      const failures: string[] = []
      for (let seed = 1; seed <= 1500; seed += 1) {
        const source = createDamagedSession(seed)
        const result = verifySessionTreeRoundTrip(source, { activeThreadId: source.id, now: 0 })
        if (!result.ok) {
          failures.push(`seed ${seed}: ${result.reason}`)
          continue
        }
        const decoded = decodeSessionTree(result.tree)
        if (!decoded.ok) {
          failures.push(`seed ${seed}: ${decoded.reason}`)
          continue
        }
        const kept = new Set(displayedTexts(decoded.session))
        const lost = displayedTexts(source).filter((text) => !kept.has(text))
        if (lost.length) failures.push(`seed ${seed}: lost ${lost.join(', ')}`)
        const repaired = repairSessionV1(source)
        if (JSON.stringify(repaired) !== JSON.stringify(repairSessionV1(structuredClone(source)))) {
          failures.push(`seed ${seed}: repair is not deterministic`)
        }
        if (repairSessionV1(repaired) !== repaired) failures.push(`seed ${seed}: repair is not idempotent`)
      }
      expect(failures).toEqual([])
    })
  })
})
