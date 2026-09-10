import { buildContext, selectContextMessages } from '@shared/context'
import type { Message, Session, Settings } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { getCompactionContext } from './compaction-context'
import { assessContextPressure } from './context-pressure'

vi.mock('../model-registry', () => ({ getModelContextWindowSync: () => 128_000 }))

const settings = {
  defaultChatModel: { provider: 'openai', model: 'chat-model' },
  compactionThreshold: 0.6,
} as Settings
const pending: Message = { id: 'pending', role: 'user', contentParts: [{ type: 'text', text: 'Next question' }] }
const text = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})
function session(messages: Message[], maxContextMessageCount?: number): Session {
  return { id: 'session', name: 'Test', type: 'chat', messages, settings: { maxContextMessageCount } }
}
const attachments = { read: async () => null }

describe('getCompactionContext', () => {
  it.each([0, 1, 4, 8, undefined])('matches the send history window for limit %s', async (limit) => {
    const current = session([text('system', 'system'), ...Array.from({ length: 20 }, (_, i) => text(`m${i}`))], limit)
    const snapshot = structuredClone(current)
    const sending = await buildContext([...current.messages, pending], {
      attachmentResolver: attachments,
      maxContextMessageCount: limit,
      toolCleanupMode: 'none',
    })
    const compacting = getCompactionContext(current, current.settings ?? {}, settings)
    expect(compacting).toEqual(sending.filter((message) => message.id !== pending.id))
    expect(compacting[0].id).toBe('system')
    expect(current).toEqual(snapshot)
  })

  it.each([100, 250_000])('matches send cleanup for tool result size %s', async (size) => {
    const oldTool: Message = {
      id: 'old-tool',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tool-1',
          toolName: 'search',
          args: { query: 'test' },
          result: 'r'.repeat(size),
        },
      ],
    }
    const current = session([
      text('u1'),
      oldTool,
      text('u2'),
      text('a2', 'assistant'),
      text('u3'),
      text('a3', 'assistant'),
    ])
    const sending = await buildContext([...current.messages, pending], {
      attachmentResolver: attachments,
      toolCleanupMode: size > 100 ? 'stub-old-results' : 'none',
    })
    expect(getCompactionContext(current, {}, settings)).toEqual(sending.filter((message) => message.id !== pending.id))
    expect(oldTool.contentParts[0]).toMatchObject({ result: 'r'.repeat(size) })
  })

  it('uses the pending input when matching the send pressure without summarizing that input', async () => {
    const current = session([
      text('u1'),
      {
        id: 'old-tool',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'search',
            args: {},
            result: 'result to clear',
          },
        ],
      },
      text('u2'),
      text('a2', 'assistant'),
      text('u3'),
      text('a3', 'assistant'),
    ])
    const largePending: Message = { ...pending, tokenCountMap: { default: 100_000 } }
    const messages = [...current.messages, largePending]
    const pressure = assessContextPressure({
      contextMessages: selectContextMessages(messages),
      providerId: 'openai',
      modelId: 'chat-model',
      compactionThreshold: settings.compactionThreshold,
    })
    expect(pressure.toolCleanupMode).toBe('stub-old-results')
    const sending = await buildContext(messages, {
      attachmentResolver: attachments,
      toolCleanupMode: pressure.toolCleanupMode,
    })
    const compacting = getCompactionContext(current, {}, settings, largePending)
    expect(compacting).toEqual(sending.filter((message) => message.id !== largePending.id))
    expect(compacting.find((message) => message.id === 'old-tool')?.contentParts[0]).toMatchObject({
      result: { _cleared: true },
    })
    expect(compacting.some((message) => message.id === largePending.id)).toBe(false)
  })

  it.each([false, true])('matches send cleanup with sandbox metadata mode %s', async (sandboxMode) => {
    const current = session([
      text('u1'),
      {
        id: 'old-tool',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'search',
            args: {},
            result: 'stored tool result',
          },
        ],
      },
      text('u2'),
      text('a2', 'assistant'),
      text('u3'),
      text('a3', 'assistant'),
    ])
    current.messages[0].files = [
      {
        id: 'file',
        name: 'large.txt',
        fileType: 'text/plain',
        storageKey: 'file-key',
        tokenCountMap: { default: 100_000 },
      },
    ]
    const messages = [...current.messages, pending]
    const pressure = assessContextPressure({
      contextMessages: selectContextMessages(messages),
      providerId: 'openai',
      modelId: 'chat-model',
      sandboxMode,
    })
    expect(pressure.toolCleanupMode).toBe(sandboxMode ? 'none' : 'stub-old-results')
    const sending = await buildContext(messages, {
      attachmentResolver: attachments,
      sandboxMode,
      toolCleanupMode: pressure.toolCleanupMode,
    })
    const compacting = getCompactionContext(current, {}, settings, pending, sandboxMode)
    expect(compacting.map((message) => message.id)).toEqual(
      sending.filter((message) => message.id !== pending.id).map((message) => message.id)
    )
    expect(compacting.find((message) => message.id === 'old-tool')).toEqual(
      sending.find((message) => message.id === 'old-tool')
    )
  })

  it('keeps the latest applicable summary only when it fits in the send window', async () => {
    const current = session(
      [
        text('u1'),
        text('a1', 'assistant'),
        { ...text('summary', 'assistant'), isSummary: true },
        text('u2'),
        text('a2', 'assistant'),
      ],
      2
    )
    current.compactionPoints = [{ boundaryMessageId: 'a1', summaryMessageId: 'summary', createdAt: 1 }]
    const sending = await buildContext([...current.messages, pending], {
      attachmentResolver: attachments,
      compactionPoints: current.compactionPoints,
      maxContextMessageCount: 2,
      toolCleanupMode: 'none',
    })
    const compacting = getCompactionContext(current, current.settings ?? {}, settings)
    expect(compacting).toEqual(sending.filter((message) => message.id !== pending.id))
    expect(compacting.map((message) => message.id)).toEqual(['u2', 'a2'])
  })
})
