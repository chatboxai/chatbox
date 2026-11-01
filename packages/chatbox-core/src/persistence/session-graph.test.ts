import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../types'
import {
  ACTIVE_SESSION_THREAD_KEY,
  type PersistedSessionGraph,
  SessionGraphCodec,
  SessionGraphCodecError,
} from './session-graph'

function textMessage(id: string, text: string, timestamp: number): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text }], timestamp }
}

function createFixture(): Session {
  const generating = {
    id: 'assistant-generating',
    role: 'assistant',
    generating: true,
    timestamp: 200,
    updatedAt: 250,
    files: [
      {
        id: 'file-1',
        name: 'notes.txt',
        fileType: 'text/plain',
        storageKey: 'blob:file-1',
        parserType: 'plain-text',
      },
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
    messages: [textMessage('user-1', 'Hello', 100), generating],
    compactionPoints: [{ summaryMessageId: 'assistant-generating', boundaryMessageId: 'user-1', createdAt: 300 }],
    threads: [
      {
        id: 'history-1',
        name: 'Earlier thread',
        createdAt: 10,
        messages: [textMessage('history-user', 'Earlier', 11)],
        compactionPoints: [{ summaryMessageId: 'history-user', boundaryMessageId: 'history-user', createdAt: 12 }],
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
        position: 1,
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
      'fork-answer': {
        position: 0,
        createdAt: 420,
        lists: [{ id: 'nested-empty', messages: [] }],
      },
    },
    futureSessionField: { retained: 'yes' },
  } as Session & { futureSessionField: { retained: string } }
}

describe('SessionGraphCodec', () => {
  it('round-trips the complete persistable graph and normalizes interrupted generation', () => {
    const source = createFixture()
    const graph = SessionGraphCodec.encode(source, { interruptedAt: 1_000 })
    const decoded = SessionGraphCodec.decode(graph) as Session & {
      futureSessionField: { retained: string }
    }

    expect(decoded).toEqual(SessionGraphCodec.persistableProjection(source, { interruptedAt: 1_000 }))
    expect(decoded.futureSessionField).toEqual({ retained: 'yes' })
    expect(decoded.threads?.[0]?.compactionPoints).toEqual(source.threads?.[0]?.compactionPoints)
    expect(decoded.threads?.[0]?.sessionPromptContextSnapshot).toEqual(
      source.threads?.[0]?.sessionPromptContextSnapshot
    )
    expect(decoded.messageForksHash?.['user-1']?.lists[0]).toEqual({ id: 'empty-branch', messages: [] })
    expect(decoded.messageForksHash?.['fork-answer']?.lists[0]?.messages).toEqual([])

    const interrupted = decoded.messages[1] as Message & {
      futureMessageField: { retained: boolean }
    }
    expect(interrupted.generating).toBe(false)
    expect(interrupted.futureMessageField).toEqual({ retained: true })
    expect(interrupted.contentParts[1]).toMatchObject({
      type: 'tool-call',
      state: 'error',
      duration: 780,
      result: { error: 'Tool execution was interrupted before its result was persisted.' },
    })
    expect(interrupted.contentParts[2]).toMatchObject({ type: 'tool-call', state: 'paused' })
    expect(source.messages[1]?.generating).toBe(true)
  })

  it('emits stable relational ownership, ordering, and parent links', () => {
    const graph = SessionGraphCodec.encode(createFixture(), { interruptedAt: 1_000 })

    expect(graph.threads.map(({ key }) => key)).toEqual([ACTIVE_SESSION_THREAD_KEY, 'archived:history-1'])
    expect(graph.messages.filter(({ threadKey }) => threadKey === ACTIVE_SESSION_THREAD_KEY)).toMatchObject([
      { id: 'user-1', sequence: 0, parentMessageId: null },
      { id: 'assistant-generating', sequence: 1, parentMessageId: 'user-1' },
    ])
    expect(graph.forkBranches).toMatchObject([
      { pivotMessageId: 'user-1', branchId: 'empty-branch', sequence: 0 },
      { pivotMessageId: 'user-1', branchId: 'answer-branch', sequence: 1 },
      { pivotMessageId: 'fork-answer', branchId: 'nested-empty', sequence: 0 },
    ])
  })

  it.each(['chat', 'picture', 'guide'] as const)('preserves %s session types', (type) => {
    const source: Session = {
      id: `session-${type}`,
      type,
      name: type,
      messages: [],
      settings: { temperature: undefined },
    }
    expect(SessionGraphCodec.persistableProjection(source)).toEqual(source)
  })

  it('retains the raw graph on corrupt rows and rejects unknown graph versions', () => {
    const corruptParent = structuredClone(SessionGraphCodec.encode(createFixture()))
    const second = corruptParent.messages.find(({ id }) => id === 'assistant-generating')
    if (!second) throw new Error('fixture message missing')
    second.parentMessageId = 'wrong-parent'

    expect(() => SessionGraphCodec.decode(corruptParent)).toThrow(SessionGraphCodecError)
    try {
      SessionGraphCodec.decode(corruptParent)
    } catch (error) {
      expect(error).toBeInstanceOf(SessionGraphCodecError)
      expect((error as SessionGraphCodecError).graph).toBe(corruptParent)
    }

    const future = structuredClone(corruptParent) as unknown as PersistedSessionGraph
    ;(future.header as { version: number }).version = 2
    expect(() => SessionGraphCodec.decode(future)).toThrow('Unsupported session graph version: 2')
  })
})
