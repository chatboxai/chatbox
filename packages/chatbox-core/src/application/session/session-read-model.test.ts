import { describe, expect, test } from 'vitest'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Session } from '../../types/session'

function plain(): Session {
  return {
    id: 's',
    name: 'Chat',
    type: 'chat',
    messages: Array.from({ length: 120 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      contentParts: [{ type: 'text', text: `Message ${index}` }],
    })),
  }
}

describe('row session read models', () => {
  test('reads an independent header and bounded transcript pages', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(plain())
    const header = await repository.getSessionHeader('s')
    expect(header?.summary.userMessageCount).toBe(60)
    expect(header?.header).not.toHaveProperty('messages')
    expect(header?.header).not.toHaveProperty('threads')
    const page = await repository.readSessionTranscriptWindow({ sessionId: 's', limit: 50, origin: 'tail' })
    expect(page?.messages.map((row) => row.messageId)).toEqual(
      plain()
        .messages.slice(-50)
        .map((message) => message.id)
    )
    const older = await repository.readSessionTranscriptWindow({ sessionId: 's', limit: 50, cursor: page!.older! })
    expect(older?.messages.map((row) => row.messageId)).toEqual(
      plain()
        .messages.slice(20, 70)
        .map((message) => message.id)
    )
  })
  test('uses rows for generating, paused and archived conversations', async () => {
    const repository = new InMemorySessionRepository()
    const value = plain()
    value.messages[119].generating = true
    value.messages[118].contentParts = [
      {
        type: 'tool-call',
        state: 'paused',
        toolCallId: 'pause',
        toolName: 'command',
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
      },
    ]
    value.threads = [
      { id: 'history', name: 'History', createdAt: 1, messages: [{ id: 'old', role: 'user', contentParts: [] }] },
    ]
    await repository.seedSession(value)
    expect(await repository.getSessionHeader('s')).toMatchObject({
      revision: 1,
      summary: { pausedMessageCount: 1 },
      control: { generatingAssistantCount: 1 },
    })
    const page = await repository.readSessionTranscriptWindow({
      sessionId: 's',
      limit: 20,
      origin: { messageId: 'old' },
    })
    expect(page?.messages[0].messageId).toBe('old')
    expect(page?.messages.length).toBeLessThanOrEqual(20)
  })
  test('rejects a stale continuation after a local command', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession(plain())
    const page = await repository.readSessionTranscriptWindow({ sessionId: 's', limit: 50, origin: 'tail' })
    await repository.executeSessionCommand('s', { type: 'header', updater: { name: 'Renamed' } })
    await expect(
      repository.readSessionTranscriptWindow({ sessionId: 's', limit: 50, cursor: page!.older! })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })
})
