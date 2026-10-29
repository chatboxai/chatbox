import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { encodeSessionTree } from './encode'
import { normalizeSessionV1 } from './normalize'
import { verifySessionTreeRoundTrip } from './verify'

type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]

const OPTIONS = { activeThreadId: 'thread-active', now: 1_000 }

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

/**
 * A session touching every field the codec has to carry: an in-flight
 * assistant message, blob-backed attachments, an archived thread with its own
 * compaction point and prompt-context snapshot, a fork on the active path, a
 * fork entry that no longer offers a choice, and fields the schema does not
 * know about.
 */
function createRichSession(): Session {
  const generating = {
    id: 'assistant-generating',
    role: 'assistant',
    generating: true,
    timestamp: 200,
    updatedAt: 250,
    files: [
      { id: 'file-1', name: 'notes.txt', fileType: 'text/plain', storageKey: 'blob:file-1', parserType: 'plain-text' },
    ],
    contentParts: [
      { type: 'reasoning', text: 'Checking', startTime: 180 },
      {
        type: 'tool-call',
        state: 'call',
        toolCallId: 'call-1',
        toolName: 'read_file',
        args: { path: 'notes.txt' },
        startTime: 220,
      },
      {
        type: 'tool-call',
        state: 'paused',
        toolCallId: 'call-2',
        toolName: 'shell',
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 3 },
      },
    ],
    futureMessageField: { retained: true },
  } as Message & { futureMessageField: { retained: boolean } }

  return {
    id: 'session-complete',
    type: 'guide',
    name: 'Structured session',
    threadName: 'Current thread',
    starred: true,
    assistantAvatarKey: 'blob:avatar',
    backgroundImage: { type: 'storage-key', storageKey: 'blob:background' },
    settings: { temperature: 0.4 },
    messages: [{ ...message('user-1'), timestamp: 100 }, generating],
    compactionPoints: [{ summaryMessageId: 'assistant-generating', boundaryMessageId: 'user-1', createdAt: 300 }],
    threads: [
      {
        id: 'history-1',
        name: 'Earlier thread',
        createdAt: 10,
        messages: [{ ...message('history-user'), timestamp: 11 }, summaryMessage('history-summary')],
        compactionPoints: [{ summaryMessageId: 'history-summary', boundaryMessageId: 'history-user', createdAt: 12 }],
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'Archived soul',
          memories: [],
          workspaceInstructions: 'Keep the archived context.',
          workspaceDirectories: ['/workspace'],
          capturedAt: 13,
          scope: 'agent',
        },
      },
    ],
    messageForksHash: {
      'user-1': {
        position: 0,
        createdAt: 400,
        lists: [
          { id: 'empty-branch', messages: [] },
          {
            id: 'answer-branch',
            messages: [
              {
                id: 'fork-answer',
                role: 'assistant',
                contentParts: [{ type: 'text', text: 'Alternative' }],
                timestamp: 410,
              },
            ],
          },
        ],
      },
      'fork-answer': { position: 0, createdAt: 420, lists: [{ id: 'nested-empty', messages: [] }] },
    },
    futureSessionField: { retained: 'yes' },
  } as Session & { futureSessionField: { retained: string } }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function createRandomSession(seed: number): Session {
  const random = mulberry32(seed)
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  let counter = 0
  const nextId = (prefix: string) => `${prefix}-${seed}-${++counter}`

  const forks: Record<string, MessageForkEntry> = {}
  const plainMessageIds: string[] = []

  const buildChain = (depth: number): Message[] => {
    const chain: Message[] = []
    for (let index = 0; index < pick(0, 4); index += 1) {
      if (random() < 0.15) {
        chain.push({ ...summaryMessage(nextId('s')), timestamp: pick(1, 900) })
        continue
      }
      const entry: Message = {
        ...message(nextId('m'), random() < 0.5 ? 'user' : 'assistant'),
        timestamp: pick(1, 900),
        ...(random() < 0.2 ? { updatedAt: pick(900, 1_800) } : {}),
        ...(random() < 0.1 ? { generating: true } : {}),
      }
      chain.push(entry)
      plainMessageIds.push(entry.id)

      if (depth >= 3 || random() >= 0.35) {
        continue
      }
      for (let anchored = pick(0, 2); anchored > 0; anchored -= 1) {
        chain.push({ ...summaryMessage(nextId('s')), timestamp: pick(1, 900) })
      }
      const activeTail = buildChain(depth + 1)
      const saved = Array.from({ length: pick(1, 2) }, () => {
        const branch = buildChain(depth + 1)
        return { id: nextId('list'), messages: branch.length > 0 ? branch : [message(nextId('m'))] }
      })
      const position = pick(0, saved.length)
      const lists = [
        ...saved.slice(0, position),
        { id: nextId('list'), messages: [] },
        ...saved.slice(position),
        ...(random() < 0.25 ? [{ id: nextId('list'), messages: [] }] : []),
      ]
      forks[entry.id] = { position, lists, createdAt: pick(1, 900) }
      chain.push(...activeTail)
      return chain
    }
    return chain
  }

  const compactionPointsFor = (messages: Message[]) =>
    messages.flatMap((entry, index) =>
      entry.isSummary && index > 0
        ? [{ summaryMessageId: entry.id, boundaryMessageId: messages[index - 1].id, createdAt: pick(1, 900) }]
        : []
    )

  const messages = buildChain(0)
  const threads = Array.from({ length: pick(0, 2) }, (_unused, index) => {
    const threadMessages = buildChain(0)
    return {
      id: `thread-${seed}-${index}`,
      name: `Thread ${index}`,
      createdAt: pick(1, 900),
      messages: threadMessages,
      compactionPoints: compactionPointsFor(threadMessages),
    }
  })

  if (random() < 0.3) {
    forks[nextId('orphan')] = {
      position: 0,
      createdAt: 1,
      lists: [{ id: nextId('list'), messages: [] }],
    }
  }
  const degenerateTarget = plainMessageIds.find((id) => !forks[id])
  if (degenerateTarget && random() < 0.3) {
    forks[degenerateTarget] = { position: 0, createdAt: 1, lists: [{ id: nextId('list'), messages: [] }] }
  }

  return {
    id: `session-${seed}`,
    name: `Session ${seed}`,
    messages,
    threadName: random() < 0.5 ? `Thread name ${seed}` : undefined,
    compactionPoints: compactionPointsFor(messages),
    threads,
    messageForksHash: forks,
  }
}

describe('verifySessionTreeRoundTrip', () => {
  test('round-trips all external fields with forks, archives and compaction', () => {
    const source = createRichSession()
    const result = verifySessionTreeRoundTrip(source, OPTIONS)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) {
      return
    }
    const generating = result.tree.messages.find((row) => row.messageId === 'assistant-generating')
    expect(generating).toMatchObject({ status: 'generating', createdAt: 200, updatedAt: 250 })
    expect(generating?.message.generating).toBe(true)
    expect(generating?.message.contentParts[1]).toMatchObject({ state: 'call' })
    expect(result.tree.session).toMatchObject({ futureSessionField: { retained: 'yes' }, storageFormat: 'rows' })
    expect(result.tree.session.forkCreatedAt).toEqual({ 'user-1': 400 })
    expect(result.tree.messages.map((row) => row.messageId)).toEqual([
      'user-1',
      'assistant-generating',
      'fork-answer',
      'history-user',
      'history-summary',
    ])
    // The active compaction point names a message that is not a summary.
    expect(result.tree.threads[0].compactionPoints).toEqual([])
    expect(result.tree.threads[1].compactionPoints).toEqual([
      { summaryMessageId: 'history-summary', boundaryMessageId: 'history-user', createdAt: 12 },
    ])
  })

  test('round-trips an empty session', () => {
    expect(verifySessionTreeRoundTrip({ id: 'session-1', name: 'Session', messages: [] }, OPTIONS)).toMatchObject({
      ok: true,
    })
  })

  test('encodes the same tree for the same active thread id', () => {
    const source = createRichSession()
    const first = encodeSessionTree(source, OPTIONS)
    const second = encodeSessionTree(source, OPTIONS)
    if (!first.ok || !second.ok) {
      throw new Error('encoding failed')
    }

    expect(second.tree).toEqual(first.tree)

    const normalizedOnce = normalizeSessionV1(source)
    if (!normalizedOnce.ok) {
      throw new Error(normalizedOnce.reason)
    }
    const reencoded = encodeSessionTree(normalizedOnce.session, OPTIONS)
    if (!reencoded.ok) {
      throw new Error(reencoded.reason)
    }
    expect(reencoded.tree).toEqual(first.tree)
  })

  test('reports the failure instead of throwing on input it cannot encode', () => {
    expect(
      verifySessionTreeRoundTrip(
        {
          id: 'session-1',
          name: 'Session',
          messages: [message('u1')],
          threads: [{ id: OPTIONS.activeThreadId, name: 'Archived', createdAt: 1, messages: [message('u0')] }],
        },
        OPTIONS
      )
    ).toEqual({ ok: false, reason: `archived thread ${OPTIONS.activeThreadId} collides with the active thread id` })
  })

  test('round-trips randomly generated sessions', () => {
    const failures: string[] = []
    const coverage = { forks: 0, nestedForks: 0, emptyActiveBranches: 0, summaries: 0, archivedThreads: 0 }

    for (let seed = 1; seed <= 300; seed += 1) {
      const source = createRandomSession(seed)
      const result = verifySessionTreeRoundTrip(source, OPTIONS)
      if (!result.ok) {
        failures.push(`seed ${seed}: ${result.reason}`)
        continue
      }
      const pivots = Object.keys(source.messageForksHash ?? {})
      coverage.forks += pivots.length > 0 ? 1 : 0
      coverage.nestedForks += Object.values(source.messageForksHash ?? {}).some((fork) =>
        fork.lists.some((list) => list.messages.some((entry) => pivots.includes(entry.id)))
      )
        ? 1
        : 0
      coverage.emptyActiveBranches += result.tree.messages.some(
        (row) =>
          row.activeChildId === null && result.tree.messages.some((other) => other.parentMessageId === row.messageId)
      )
        ? 1
        : 0
      coverage.summaries += result.tree.messages.some((row) => row.kind === 'summary') ? 1 : 0
      coverage.archivedThreads += (source.threads ?? []).length > 0 ? 1 : 0
    }

    expect(failures).toEqual([])
    for (const [shape, count] of Object.entries(coverage)) {
      expect(count, `${shape} never appeared in the generated corpus`).toBeGreaterThan(10)
    }
  })
})
