import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import {
  PROMPT_CACHE_CONFIRM_MIN_CHARS,
  shouldConfirmPromptCacheBreak,
  shouldConfirmPromptCacheBreakForDelete,
} from './prompt-cache-policy'

function textMessage(role: Message['role'], text: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `${role}-${text.length}`,
    role,
    contentParts: [{ type: 'text', text }],
    ...overrides,
  }
}

function longText(size = PROMPT_CACHE_CONFIRM_MIN_CHARS): string {
  return 'x'.repeat(size)
}

describe('shouldConfirmPromptCacheBreak', () => {
  it('stays quiet in chat mode even with a long work-like transcript', () => {
    expect(
      shouldConfirmPromptCacheBreak('chat', [textMessage('user', 'hello'), textMessage('assistant', longText())])
    ).toBe(false)
  })

  it('stays quiet in work mode before the first assistant request starts', () => {
    expect(shouldConfirmPromptCacheBreak('work', [textMessage('user', longText())])).toBe(false)
    expect(shouldConfirmPromptCacheBreak('work', [textMessage('assistant', longText(), { generating: true })])).toBe(
      false
    )
  })

  it('asks once a long first-turn request has started streaming', () => {
    expect(
      shouldConfirmPromptCacheBreak('work', [
        textMessage('user', longText()),
        textMessage('assistant', 'partial reply', { generating: true }),
      ])
    ).toBe(true)
  })

  it('stays quiet for a short completed work-mode turn without tools', () => {
    expect(shouldConfirmPromptCacheBreak('work', [textMessage('user', 'hi'), textMessage('assistant', 'hello')])).toBe(
      false
    )
  })

  it('asks in work mode once the visible transcript is long enough', () => {
    expect(
      shouldConfirmPromptCacheBreak('work', [
        textMessage('user', 'summarize this'),
        textMessage('assistant', longText()),
      ])
    ).toBe(true)
  })

  it('asks in work mode as soon as a completed turn used tools', () => {
    expect(
      shouldConfirmPromptCacheBreak('work', [
        textMessage('user', 'fix the build'),
        {
          id: 'assistant-1',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'ok' },
            { type: 'tool-call', state: 'result', toolCallId: 'c1', toolName: 'read_file', args: {} },
          ],
        } as Message,
      ])
    ).toBe(true)
  })

  it('asks in work mode when a compaction summary is already on the path', () => {
    expect(
      shouldConfirmPromptCacheBreak('work', [
        textMessage('assistant', 'Earlier messages summarized', { isSummary: true }),
      ])
    ).toBe(true)
  })

  it('ignores a UI-only fork marker as evidence that a request started', () => {
    expect(
      shouldConfirmPromptCacheBreak('work', [
        textMessage('user', longText()),
        textMessage('assistant', '', { isForkMarker: true }),
      ])
    ).toBe(false)
  })
})

describe('shouldConfirmPromptCacheBreakForDelete', () => {
  const messages = [
    textMessage('user', 'question'),
    textMessage('assistant', longText()),
    textMessage('assistant', '', { isForkMarker: true }),
  ]

  it('keeps the latest real message on the existing inline confirmation', () => {
    expect(shouldConfirmPromptCacheBreakForDelete('work', messages, messages[1].id, 'message')).toBe(false)
    expect(shouldConfirmPromptCacheBreakForDelete('work', messages, messages[0].id, 'message')).toBe(true)
  })

  it('ignores an anchored summary when locating the latest real message', () => {
    const boundary = textMessage('assistant', longText())
    const summary = textMessage('assistant', 'Earlier messages summarized', { isSummary: true })

    expect(shouldConfirmPromptCacheBreakForDelete('work', [boundary, summary], boundary.id, 'message')).toBe(false)
  })

  it('evaluates cache stake from the selected provider context', () => {
    const oldLongReply = textMessage('assistant', longText())
    const recentUser = textMessage('user', 'recent question')
    const recentReply = textMessage('assistant', 'recent answer')

    expect(
      shouldConfirmPromptCacheBreakForDelete(
        'work',
        [oldLongReply, recentUser, recentReply],
        oldLongReply.id,
        'message',
        {
          contextMessages: [recentUser, recentReply],
          hasStartedAssistantRequest: true,
        }
      )
    ).toBe(false)
  })

  it('stays quiet when deleting the target leaves provider context unchanged', () => {
    const failedReply = textMessage('assistant', 'failed', { error: 'request failed' })
    const recentUser = textMessage('user', 'recent question')
    const recentReply = textMessage('assistant', longText())

    expect(
      shouldConfirmPromptCacheBreakForDelete(
        'work',
        [failedReply, recentUser, recentReply],
        failedReply.id,
        'message',
        {
          contextMessages: [recentUser, recentReply],
          deletionChangesContext: false,
        }
      )
    ).toBe(false)
  })

  it('reclassifies a latest message when the queue appends a reply', () => {
    const queuedUser = textMessage('user', 'queued follow-up')
    expect(shouldConfirmPromptCacheBreakForDelete('work', [...messages, queuedUser], queuedUser.id, 'message')).toBe(
      false
    )

    const generatingReply = textMessage('assistant', 'partial reply', { generating: true })
    expect(
      shouldConfirmPromptCacheBreakForDelete(
        'work',
        [...messages, queuedUser, generatingReply],
        queuedUser.id,
        'message'
      )
    ).toBe(true)
  })

  it('does not warn for a message outside the active context path', () => {
    expect(shouldConfirmPromptCacheBreakForDelete('work', messages, 'archived-message', 'message')).toBe(false)
  })

  it('keeps the cache explanation in the summary restore dialog', () => {
    const summary = textMessage('assistant', 'Earlier messages summarized', { isSummary: true })
    expect(shouldConfirmPromptCacheBreakForDelete('work', [summary], summary.id, 'summary')).toBe(true)
  })
})
