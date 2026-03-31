import { describe, expect, it } from 'vitest'
import { migrateMessage } from './message'

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

  it('preserves forward-compatible app-like content parts during hydration', () => {
    const appPart = {
      type: 'app',
      appId: 'story-builder',
      appInstanceId: 'instance-1',
      state: 'active',
    }

    const migrated = migrateMessage({
      id: 'msg-2',
      role: 'assistant',
      content: 'legacy text should not replace app state',
      contentParts: [appPart] as never,
    } as never)

    expect(migrated.contentParts).toHaveLength(1)
    expect(migrated.contentParts[0] as unknown).toMatchObject(appPart)
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
})
