import { describe, expect, test } from 'vitest'
import { nonSessionStorageKey } from './non-session-key'

describe('nonSessionStorageKey', () => {
  test('returns non-Session keys unchanged', () => {
    expect(nonSessionStorageKey('file:asset_tokenMap')).toBe('file:asset_tokenMap')
  })

  test('rejects Session keys', () => {
    expect(() => nonSessionStorageKey('session:session-1')).toThrow(
      'Session storage keys must be persisted through CurrentSessionRepository.'
    )
  })
})
