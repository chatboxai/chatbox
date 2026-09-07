import { describe, expect, it } from 'vitest'
import {
  latestConversationMessageHasChatboxSearchSignInError,
  messageHasChatboxSearchSignInError,
} from '@shared/session/web-search-sign-in-error'
import type { Message, Session } from '../../types/session'
import { deriveSessionRecord, encodeSessionTree } from './encode'
import { decodeSessionTree } from './decode'

function message(id: string, error = false): Message {
  return {
    id,
    role: 'assistant',
    contentParts: error
      ? [
          {
            type: 'tool-call',
            toolCallId: `call-${id}`,
            toolName: 'web_search',
            state: 'error',
            args: {},
            result: { errorCode: 20024 },
          },
        ]
      : [{ type: 'text', text: id }],
  }
}

function session(messages: Message[]): Session {
  return { id: 'search-presentation', name: 'Search warning', type: 'chat', messages }
}

describe('search warning read projection', () => {
  it('preserves historical and latest-message warning semantics through synthetic trailing rows', () => {
    const messages = [
      message('a', true),
      message('b', true),
      { ...message('s'), isSummary: true },
      { ...message('f'), isForkMarker: true },
      { ...message('sys'), role: 'system' as const },
    ]
    const record = deriveSessionRecord(session(messages), 'active')
    expect(record.presentation).toMatchObject({
      webSearchSignInErrorCount: 2,
      latestMessageHasWebSearchSignInError: true,
    })
    expect(latestConversationMessageHasChatboxSearchSignInError([...messages, message('user-followup')])).toBe(false)
  })

  it('updates the error count incrementally while preserving another historical error', () => {
    const before = message('a', true)
    const after = message('a')
    const current = session([before, message('b', true), message('tail')])
    const record = deriveSessionRecord(current, 'active')
    const updated = deriveSessionRecord({ ...current, messages: [after, ...current.messages.slice(1)] }, 'active', {
      record,
      before,
      after,
    })
    expect(updated.presentation).toMatchObject({
      webSearchSignInErrorCount: 1,
      latestMessageHasWebSearchSignInError: false,
    })
    const tail = message('tail', true)
    const appendedError = deriveSessionRecord({ ...current, messages: [after, current.messages[1], tail] }, 'active', {
      record: updated,
      before: current.messages[2],
      after: tail,
    })
    expect(appendedError.presentation).toMatchObject({
      webSearchSignInErrorCount: 2,
      latestMessageHasWebSearchSignInError: true,
    })
  })

  it('does not count an off-path archived error as active-conversation history', () => {
    const before = message('archived')
    const after = message('archived', true)
    const current: Session = {
      ...session([message('active')]),
      threads: [{ id: 'archive', name: 'Archive', createdAt: 1, messages: [before] }],
    }
    const record = deriveSessionRecord(current, 'active')
    const updated = deriveSessionRecord(
      { ...current, threads: [{ ...current.threads![0], messages: [after] }] },
      'active',
      { record, before, after }
    )
    expect(updated.presentation).toMatchObject({
      webSearchSignInErrorCount: 0,
      latestMessageHasWebSearchSignInError: false,
    })
  })

  it('reconstructs absent derived fields from an available complete write snapshot', () => {
    const before = message('tail')
    const current = session([message('history', true), before])
    const record = deriveSessionRecord(current, 'active')
    delete record.presentation!.webSearchSignInErrorCount
    delete record.presentation!.latestMessageHasWebSearchSignInError
    const after = { ...before, tokenCountMap: { default: 10 } }
    const updated = deriveSessionRecord({ ...current, messages: [current.messages[0], after] }, 'active', {
      record,
      before,
      after,
    })
    expect(updated.presentation).toMatchObject({
      webSearchSignInErrorCount: 1,
      latestMessageHasWebSearchSignInError: false,
    })
  })

  it('ignores non-search, successful and unrelated error codes', () => {
    const original = message('search', true)
    const part = original.contentParts[0]
    if (part.type !== 'tool-call') throw new Error('Expected fixture tool call')
    expect(messageHasChatboxSearchSignInError(undefined)).toBe(false)
    expect(messageHasChatboxSearchSignInError({ ...original, contentParts: [{ ...part, toolName: 'other' }] })).toBe(
      false
    )
    expect(messageHasChatboxSearchSignInError({ ...original, contentParts: [{ ...part, state: 'result' }] })).toBe(
      false
    )
    expect(
      messageHasChatboxSearchSignInError({ ...original, contentParts: [{ ...part, result: { errorCode: 42 } }] })
    ).toBe(false)
    expect(latestConversationMessageHasChatboxSearchSignInError([])).toBe(false)
  })

  it('does not leak derived warning metadata into decoded sessions', () => {
    const current = session([message('historical', true), message('tail')])
    const encoded = encodeSessionTree(current, { activeThreadId: current.id, now: 1 })
    if (!encoded.ok) throw new Error(encoded.reason)
    expect(encoded.tree.session.presentation?.webSearchSignInErrorCount).toBe(1)
    const decoded = decodeSessionTree(encoded.tree)
    if (!decoded.ok) throw new Error(decoded.reason)
    expect(decoded.session).not.toHaveProperty('presentation')
    expect(decoded.session.messages).toEqual(current.messages)
  })
})
