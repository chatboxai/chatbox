import type { Message } from '@shared/types'
import { describe, expect, test } from 'vitest'
import type { MessageMinimapAnchor } from './MessageMinimapRail'
import {
  areMinimapAnchorsEqual,
  canReuseMinimapAnchorsDuringGeneration,
  getMessagePreviewText,
  MINIMAP_PREVIEW_MAX_LENGTH,
} from './message-navigation-utils'

function message(contentParts: Message['contentParts']): Message {
  return { id: 'message-1', role: 'assistant', contentParts }
}

describe('getMessagePreviewText', () => {
  test('returns short text unchanged, trimmed', () => {
    expect(getMessagePreviewText(message([{ type: 'text', text: '  hello world  ' }]))).toBe('hello world')
  })

  test('joins text parts and image placeholders like getMessageText', () => {
    const msg = message([
      { type: 'text', text: 'first' },
      { type: 'image', storageKey: 'key-1' },
      { type: 'text', text: 'second' },
    ])
    expect(getMessagePreviewText(msg)).toBe('first\n[image]\nsecond')
  })

  test('excludes reasoning parts', () => {
    const msg = message([
      { type: 'reasoning', text: 'internal thoughts' },
      { type: 'text', text: 'visible answer' },
    ])
    expect(getMessagePreviewText(msg)).toBe('visible answer')
  })

  test('truncates a long part to the preview length', () => {
    const long = 'a'.repeat(MINIMAP_PREVIEW_MAX_LENGTH * 10)
    const preview = getMessagePreviewText(message([{ type: 'text', text: long }]))
    expect(preview).toBe('a'.repeat(MINIMAP_PREVIEW_MAX_LENGTH))
  })

  test('stops collecting parts once the preview length is reached', () => {
    const msg = message([
      { type: 'text', text: 'b'.repeat(MINIMAP_PREVIEW_MAX_LENGTH) },
      { type: 'text', text: 'never included' },
    ])
    expect(getMessagePreviewText(msg)).toBe('b'.repeat(MINIMAP_PREVIEW_MAX_LENGTH))
  })

  test('returns an empty string when there is no previewable content', () => {
    expect(getMessagePreviewText(message([]))).toBe('')
    expect(getMessagePreviewText(message(undefined as unknown as Message['contentParts']))).toBe('')
  })
})

describe('areMinimapAnchorsEqual', () => {
  const anchor = (overrides?: Partial<MessageMinimapAnchor>): MessageMinimapAnchor => ({
    messageId: 'user-1',
    itemIndex: 0,
    text: 'question',
    assistantText: 'answer',
    ...overrides,
  })

  test('equal contents compare equal', () => {
    expect(areMinimapAnchorsEqual([anchor()], [anchor()])).toBe(true)
    expect(areMinimapAnchorsEqual([], [])).toBe(true)
  })

  test('detects differences in any field or length', () => {
    expect(areMinimapAnchorsEqual([anchor()], [])).toBe(false)
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ messageId: 'user-2' })])).toBe(false)
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ itemIndex: 1 })])).toBe(false)
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ text: 'changed' })])).toBe(false)
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ assistantText: undefined })])).toBe(false)
  })
})

describe('canReuseMinimapAnchorsDuringGeneration', () => {
  const user = { id: 'user-1', role: 'user', contentParts: [] } satisfies Message
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    contentParts: [{ type: 'text', text: 'partial' }],
    generating: true,
  } satisfies Message

  test('allows only same-id generating assistant replacements', () => {
    expect(canReuseMinimapAnchorsDuringGeneration([user, assistant], [user, assistant])).toBe(true)
    expect(
      canReuseMinimapAnchorsDuringGeneration(
        [user, assistant],
        [user, { ...assistant, contentParts: [{ type: 'text', text: 'next chunk' }] }]
      )
    ).toBe(true)
  })

  test('rejects edits, completion, insertion, and message replacement', () => {
    expect(canReuseMinimapAnchorsDuringGeneration([user, assistant], [{ ...user }, assistant])).toBe(false)
    expect(canReuseMinimapAnchorsDuringGeneration([user, assistant], [user, { ...assistant, generating: false }])).toBe(
      false
    )
    expect(
      canReuseMinimapAnchorsDuringGeneration([user, assistant], [user, assistant, { ...user, id: 'user-2' }])
    ).toBe(false)
    expect(canReuseMinimapAnchorsDuringGeneration([user, assistant], [user, { ...assistant, id: 'assistant-2' }])).toBe(
      false
    )
    expect(
      canReuseMinimapAnchorsDuringGeneration(
        [user, { ...assistant, generating: false }],
        [user, { ...assistant, contentParts: [{ type: 'text', text: 'new generation' }] }]
      )
    ).toBe(false)
  })
})
