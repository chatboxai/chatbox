import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { Message } from '@shared/types'
import { describe, expect, test } from 'vitest'
import type { MessageMinimapAnchor } from './MessageMinimapRail'
import {
  areMinimapAnchorsEqual,
  buildMessageMinimapAnchors,
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
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ text: 'changed' })])).toBe(false)
    expect(areMinimapAnchorsEqual([anchor()], [anchor({ assistantText: undefined })])).toBe(false)
  })
})

describe('buildMessageMinimapAnchors', () => {
  const row = (id: string, role: Message['role'], threadId = 't', extra: Partial<Message> = {}): MessageRow => ({
    sessionId: 's',
    threadId,
    messageId: id,
    parentMessageId: null,
    activeChildId: null,
    seq: 0,
    kind: 'message',
    status: 'settled',
    createdAt: 1,
    updatedAt: 1,
    branchId: null,
    message: { id, role, contentParts: [{ type: 'text', text: id }], ...extra },
  })

  test('pairs each loaded user with its first eligible assistant in the same thread', () => {
    const rows = [
      row('leading', 'assistant'),
      row('u1', 'user'),
      row('summary', 'user', 't', { isSummary: true }),
      row('a1', 'assistant'),
      row('a2', 'assistant'),
      row('u2', 'user'),
      row('other-thread', 'assistant', 'next'),
      row('u3', 'user', 'next'),
      row('a3', 'assistant', 'next'),
    ]
    expect(buildMessageMinimapAnchors(rows)).toEqual([
      { messageId: 'u1', text: 'u1', assistantText: 'a1' },
      { messageId: 'u2', text: 'u2' },
      { messageId: 'u3', text: 'u3', assistantText: 'a3' },
    ])
  })

  test('follows loaded-window replacement and streaming message updates', () => {
    const user = row('user', 'user')
    const reply = row('reply', 'assistant', 't', {
      generating: true,
      contentParts: [{ type: 'text', text: 'partial' }],
    })
    expect(buildMessageMinimapAnchors([user, reply])[0].assistantText).toBe('partial')
    const completed = {
      ...reply,
      message: { ...reply.message, generating: false, contentParts: [{ type: 'text' as const, text: 'finished' }] },
    }
    expect(buildMessageMinimapAnchors([user, completed])[0].assistantText).toBe('finished')
    expect(buildMessageMinimapAnchors([completed, row('next', 'user')])).toEqual([{ messageId: 'next', text: 'next' }])
    expect(buildMessageMinimapAnchors([])).toEqual([])
  })

  test('bounds multipart previews including separators', () => {
    const parts: Message['contentParts'] = Array.from({ length: 400 }, () => ({ type: 'text', text: 'x' }))
    expect(getMessagePreviewText(message(parts))).toHaveLength(299)
    expect(
      getMessagePreviewText(
        message([
          { type: 'text', text: 'a'.repeat(299) },
          { type: 'text', text: 'b' },
        ])
      )
    ).toHaveLength(299)
  })
})
