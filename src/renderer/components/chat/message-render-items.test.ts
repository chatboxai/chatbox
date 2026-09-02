import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildMessageRenderItems } from './message-render-items'

function makeMessage(id: string, role: Message['role'], isForkMarker?: boolean): Message {
  return { id, role, contentParts: [], isForkMarker } as unknown as Message
}

describe('buildMessageRenderItems', () => {
  it('groups the latest user message with its assistant reply', () => {
    const messages = [
      makeMessage('u1', 'user'),
      makeMessage('a1', 'assistant'),
      makeMessage('u2', 'user'),
      makeMessage('a2', 'assistant'),
    ]
    const items = buildMessageRenderItems(messages)
    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'group'])
    expect(items[2].messages.map((message) => message.id)).toEqual(['u2', 'a2'])
  })

  it('groups a trailing user message alone while awaiting the reply', () => {
    const items = buildMessageRenderItems([makeMessage('a1', 'assistant'), makeMessage('u1', 'user')])
    expect(items.map((item) => item.type)).toEqual(['message', 'group'])
    expect(items[1].messages.map((message) => message.id)).toEqual(['u1'])
  })

  it('does not group when the reply is a fork marker', () => {
    const items = buildMessageRenderItems([makeMessage('u1', 'user'), makeMessage('a1', 'assistant', true)])
    expect(items.map((item) => item.type)).toEqual(['message', 'message'])
  })

  it('keeps messages after the grouped turn as their own items', () => {
    const items = buildMessageRenderItems([
      makeMessage('u1', 'user'),
      makeMessage('a1', 'assistant'),
      makeMessage('a2', 'assistant'),
    ])
    expect(items.map((item) => item.type)).toEqual(['group', 'message'])
    expect(items[1].messages[0].id).toBe('a2')
  })

  it('keeps the last-turn group key stable when the assistant reply arrives', () => {
    const waiting = buildMessageRenderItems([makeMessage('u1', 'user')])
    const replied = buildMessageRenderItems([makeMessage('u1', 'user'), makeMessage('a1', 'assistant')])
    expect(waiting[0]?.key).toBe('group-u1')
    expect(replied[0]?.key).toBe(waiting[0]?.key)
  })
})

// scrollToMessage locates a message's Virtuoso item via findIndex over the built
// items — every message must be findable in exactly one item.
describe('locating a message in the built items', () => {
  it('finds every message exactly once across grouping shapes', () => {
    const cases = [
      [
        makeMessage('u1', 'user'),
        makeMessage('a1', 'assistant'),
        makeMessage('u2', 'user'),
        makeMessage('a2', 'assistant'),
      ],
      [makeMessage('u1', 'user')],
      [makeMessage('a1', 'assistant'), makeMessage('u1', 'user')],
      [makeMessage('u1', 'user'), makeMessage('a1', 'assistant'), makeMessage('a2', 'assistant')],
      [makeMessage('u1', 'user'), makeMessage('a1', 'assistant', true)],
    ]
    for (const messages of cases) {
      const items = buildMessageRenderItems(messages)
      for (const message of messages) {
        const matches = items.filter((item) => item.messages.some((m) => m.id === message.id))
        expect(matches).toHaveLength(1)
      }
    }
  })

  it('maps both messages of the grouped last turn to the same item', () => {
    const messages = [
      makeMessage('u1', 'user'),
      makeMessage('a1', 'assistant'),
      makeMessage('u2', 'user'),
      makeMessage('a2', 'assistant'),
    ]
    const items = buildMessageRenderItems(messages)
    const findItemIndex = (id: string) => items.findIndex((item) => item.messages.some((m) => m.id === id))
    expect(findItemIndex('u2')).toBe(2)
    expect(findItemIndex('a2')).toBe(2)
    expect(findItemIndex('u1')).toBe(0)
  })
})
