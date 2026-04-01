import { describe, expect, it } from 'vitest'
import { getMessageAppPartText, getMessageText, migrateMessage } from './message'

describe('migrateMessage', () => {
  it('preserves structured content parts when a legacy content field is also present', () => {
    const migrated = migrateMessage({
      id: 'msg-1',
      role: 'assistant',
      content: 'legacy content fallback',
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tool-1',
          toolName: 'search',
          args: { query: 'chatbridge' },
          result: { hits: 1 },
        },
      ],
    } as never)

    expect(migrated.contentParts).toHaveLength(1)
    expect(migrated.contentParts[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'search',
    })
  })

  it('normalizes legacy app parts that used state instead of lifecycle during hydration', () => {
    const legacyAppPart = {
      type: 'app',
      appId: 'story-builder',
      appInstanceId: 'instance-1',
      state: 'active',
    }

    const migrated = migrateMessage({
      id: 'msg-2',
      role: 'assistant',
      content: 'legacy text should not replace app state',
      contentParts: [legacyAppPart] as never,
    } as never)

    expect(migrated.contentParts).toHaveLength(1)
    expect(migrated.contentParts[0]).toMatchObject({
      type: 'app',
      appId: 'story-builder',
      appInstanceId: 'instance-1',
      lifecycle: 'active',
    })
  })

  it('still falls back to legacy content when content parts only contain placeholder text', () => {
    const migrated = migrateMessage({
      id: 'msg-3',
      role: 'assistant',
      content: 'Recovered body',
      contentParts: [{ type: 'text', text: '...' }],
    } as never)

    expect(migrated.contentParts).toEqual([{ type: 'text', text: 'Recovered body' }])
  })

  it('uses app lifecycle summaries in message text output', () => {
    const message = migrateMessage({
      id: 'msg-4',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'instance-2',
          lifecycle: 'complete',
          summary: 'Saved the previous draft summary for later follow-up questions.',
        },
      ],
    } as never)

    expect(getMessageAppPartText(message.contentParts[0])).toBe(
      'Saved the previous draft summary for later follow-up questions.'
    )
    expect(getMessageText(message)).toBe('Saved the previous draft summary for later follow-up questions.')
  })

  it('preserves host-owned app shell fields during hydration', () => {
    const migrated = migrateMessage({
      id: 'msg-5',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'instance-5',
          lifecycle: 'error',
          title: 'Story Builder recovery',
          description: 'The host kept the degraded ending inline.',
          statusText: 'Invalid completion',
          fallbackTitle: 'Invalid completion fallback',
          fallbackText: 'Malformed completion fields remain blocked from model memory.',
          values: {
            chatbridgeDegradedCompletion: {
              schemaVersion: 1,
              kind: 'invalid-completion',
            },
          },
        },
      ],
    } as never)

    expect(migrated.contentParts[0]).toMatchObject({
      type: 'app',
      title: 'Story Builder recovery',
      description: 'The host kept the degraded ending inline.',
      statusText: 'Invalid completion',
      fallbackTitle: 'Invalid completion fallback',
      fallbackText: 'Malformed completion fields remain blocked from model memory.',
      values: {
        chatbridgeDegradedCompletion: {
          schemaVersion: 1,
          kind: 'invalid-completion',
        },
      },
    })
  })
})
