import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../types'
import {
  backfillMissingThreadName,
  buildNameGenerationAttemptKey,
  DEFAULT_INBOX_SESSION_ID,
  getCurrentThreadNamingIdentity,
  isNameGenerationAttemptKeyForSession,
  resolveAutoTitleAction,
  sanitizeGeneratedSessionName,
  shouldBackfillThreadName,
} from './auto-title'

function message(role: Message['role'], text: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `${role}-${text}`,
    role,
    contentParts: text ? [{ type: 'text', text }] : [],
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Untitled',
    type: 'chat',
    messages: [],
    ...overrides,
  }
}

const firstTurn = [message('user', 'hello'), message('assistant', 'hi', { finishReason: 'stop' })]

describe('sanitizeGeneratedSessionName', () => {
  it('strips quotes and multiline think blocks', () => {
    expect(sanitizeGeneratedSessionName('"北京旅行计划"')).toBe('北京旅行计划')
    expect(sanitizeGeneratedSessionName('<think>\nreasoning\nmore\n</think>\n周末计划')).toBe('周末计划')
  })

  it('returns empty when only a think block remains', () => {
    expect(sanitizeGeneratedSessionName('<think>\nonly thinking\n</think>')).toBe('')
  })
})

describe('threadName backfill', () => {
  it('copies name onto historical sessions that never had threadName', () => {
    const named = session({ name: '北京旅行计划', messages: firstTurn })
    expect(shouldBackfillThreadName(named)).toBe(true)
    expect(backfillMissingThreadName(named)).toEqual({
      session: { ...named, threadName: '北京旅行计划' },
      changed: true,
    })
  })

  it('does not backfill Untitled, inbox, or an already present field', () => {
    expect(shouldBackfillThreadName(session({ messages: firstTurn }))).toBe(false)
    expect(
      shouldBackfillThreadName(
        session({
          id: DEFAULT_INBOX_SESSION_ID,
          name: 'Just chat',
          messages: firstTurn,
        })
      )
    ).toBe(false)
    expect(shouldBackfillThreadName(session({ name: 'Named', threadName: '' }))).toBe(false)
    expect(shouldBackfillThreadName(session({ name: 'Named', threadName: 'Thread' }))).toBe(false)
  })

  it('restores pending instead of the old name when there is no title-worthy content', () => {
    // Cleared under the old semantics (undefined meant "pending") or never
    // chatted in: the next conversation must still get first-reply AI naming.
    const cleared = session({ name: '北京旅行计划', messages: [message('system', 'You are helpful')] })
    expect(shouldBackfillThreadName(cleared)).toBe(true)
    expect(backfillMissingThreadName(cleared)).toEqual({
      session: { ...cleared, threadName: '' },
      changed: true,
    })
  })

  it('does not treat a newly created named session as historical', () => {
    expect(shouldBackfillThreadName(session({ name: 'Travel planner', threadName: '' }))).toBe(false)
    expect(backfillMissingThreadName(session({ name: 'Travel planner', threadName: '', messages: firstTurn }))).toEqual(
      {
        session: session({ name: 'Travel planner', threadName: '', messages: firstTurn }),
        changed: false,
      }
    )
  })
})

describe('resolveAutoTitleAction', () => {
  it('names Untitled sessions after the first successful reply', () => {
    expect(resolveAutoTitleAction(session({ messages: firstTurn }))).toBe('session-and-thread')
  })

  it('names a pending thread without copying a historical title', () => {
    expect(
      resolveAutoTitleAction(
        session({
          name: 'Existing title',
          threadName: '',
          messages: firstTurn,
        })
      )
    ).toBe('thread')
  })

  it('names the thread of a newly created named session after the first reply', () => {
    expect(
      resolveAutoTitleAction(
        session({
          name: 'Travel planner',
          threadName: '',
          messages: firstTurn,
        })
      )
    ).toBe('thread')
  })

  it('leaves historical missing threadName to backfill instead of the model', () => {
    expect(
      resolveAutoTitleAction(
        session({
          name: '北京旅行计划',
          messages: firstTurn,
        })
      )
    ).toBeNull()
  })

  it('still names the inbox conversation', () => {
    expect(
      resolveAutoTitleAction(
        session({
          id: DEFAULT_INBOX_SESSION_ID,
          name: 'Just chat',
          messages: firstTurn,
        })
      )
    ).toBe('thread')
  })

  it('does nothing when both titles exist', () => {
    expect(
      resolveAutoTitleAction(
        session({
          name: 'Existing title',
          threadName: 'Existing thread',
          messages: firstTurn,
        })
      )
    ).toBeNull()
  })
})

describe('thread naming identity', () => {
  it('stays stable while the current turn streams more assistant parts', () => {
    const live = session({
      messages: [message('user', 'hello'), message('assistant', 'hi', { generating: true })],
    })
    const streamed = session({
      messages: [message('user', 'hello'), message('assistant', 'hi there', { generating: true })],
    })

    expect(getCurrentThreadNamingIdentity(live)).toBe(getCurrentThreadNamingIdentity(streamed))
    expect(getCurrentThreadNamingIdentity(live)).toBe('user-hello')
  })

  it('changes when the current thread is archived or cleared', () => {
    const original = session({ messages: firstTurn })
    const created = session({
      messages: [message('system', 'You are helpful')],
      threads: [{ id: 'archived-1', name: 'Old', messages: firstTurn, createdAt: 1 }],
    })
    const switched = session({
      messages: [message('user', 'later'), message('assistant', 'ok', { finishReason: 'stop' })],
      threads: [{ id: 'archived-current', name: 'Old', messages: firstTurn, createdAt: 1 }],
    })
    const cleared = session({ messages: [message('system', 'You are helpful')] })

    expect(getCurrentThreadNamingIdentity(created)).not.toBe(getCurrentThreadNamingIdentity(original))
    expect(getCurrentThreadNamingIdentity(switched)).not.toBe(getCurrentThreadNamingIdentity(original))
    expect(getCurrentThreadNamingIdentity(cleared)).not.toBe(getCurrentThreadNamingIdentity(original))
    expect(getCurrentThreadNamingIdentity(created)).toBe('')
    expect(getCurrentThreadNamingIdentity(switched)).toBe('user-later')
    expect(getCurrentThreadNamingIdentity(cleared)).toBe('')
  })

  it('ignores unrelated archived-thread mutations', () => {
    const live = session({
      messages: firstTurn,
      threads: [
        { id: 'archived-1', name: 'Old', messages: [message('user', 'earlier')], createdAt: 1 },
        { id: 'archived-2', name: 'Older', messages: [message('user', 'oldest')], createdAt: 2 },
      ],
    })
    const afterDelete = session({
      messages: firstTurn,
      threads: [{ id: 'archived-2', name: 'Older', messages: [message('user', 'oldest')], createdAt: 2 }],
    })

    expect(getCurrentThreadNamingIdentity(live)).toBe(getCurrentThreadNamingIdentity(afterDelete))
    expect(getCurrentThreadNamingIdentity(live)).toBe('user-hello')
  })

  it('scopes attempt keys to a session and optional thread identity', () => {
    expect(buildNameGenerationAttemptKey('thread', 'session-1')).toBe('thread:session-1')
    expect(buildNameGenerationAttemptKey('thread', 'session-1', 'user-1')).toBe('thread:session-1:user-1')
    expect(isNameGenerationAttemptKeyForSession('thread:session-1:user-1', 'session-1')).toBe(true)
    expect(isNameGenerationAttemptKeyForSession('thread:session-10', 'session-1')).toBe(false)
    expect(isNameGenerationAttemptKeyForSession('name:session-1', 'session-1')).toBe(true)
  })
})
