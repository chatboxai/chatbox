import { describe, expect, it } from 'vitest'
import {
  buildNameGenerationAttemptKey,
  DEFAULT_INBOX_SESSION_ID,
  isNameGenerationAttemptKeyForSession,
  sanitizeGeneratedSessionName,
  shouldBackfillThreadName,
} from './auto-title'

describe('sanitizeGeneratedSessionName', () => {
  it('strips quotes and multiline think blocks', () => {
    expect(sanitizeGeneratedSessionName('"北京旅行计划"')).toBe('北京旅行计划')
    expect(sanitizeGeneratedSessionName('<think>\nreasoning\nmore\n</think>\n周末计划')).toBe('周末计划')
  })

  it('returns empty when only a think block remains', () => {
    expect(sanitizeGeneratedSessionName('<think>\nonly thinking\n</think>')).toBe('')
  })
})

describe('threadName header backfill', () => {
  it('accepts only a named historical header with a missing field', () => {
    expect(shouldBackfillThreadName({ id: 's', name: 'Travel' })).toBe(true)
    expect(shouldBackfillThreadName({ id: 's', name: 'Untitled' })).toBe(false)
    expect(shouldBackfillThreadName({ id: DEFAULT_INBOX_SESSION_ID, name: 'Just chat' })).toBe(false)
    expect(shouldBackfillThreadName({ id: 's', name: 'Travel', threadName: '' })).toBe(false)
    expect(shouldBackfillThreadName({ id: 's', name: 'Travel', threadName: 'Thread' })).toBe(false)
  })
})

describe('thread naming keys', () => {
  it('scopes attempt keys to a session and optional thread identity', () => {
    expect(buildNameGenerationAttemptKey('thread', 'session-1')).toBe('thread:session-1')
    expect(buildNameGenerationAttemptKey('thread', 'session-1', 'user-1')).toBe('thread:session-1:user-1')
    expect(isNameGenerationAttemptKeyForSession('thread:session-1:user-1', 'session-1')).toBe(true)
    expect(isNameGenerationAttemptKeyForSession('thread:session-10', 'session-1')).toBe(false)
    expect(isNameGenerationAttemptKeyForSession('name:session-1', 'session-1')).toBe(true)
  })
})
