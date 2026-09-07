import type { SessionType } from '../types'
import { describe, expect, it } from 'vitest'
import { supportsSessionGeneration } from './capabilities'

describe('supportsSessionGeneration', () => {
  it.each<{ sessionType: SessionType | undefined; expected: boolean }>([
    { sessionType: undefined, expected: true },
    { sessionType: 'chat', expected: true },
    { sessionType: 'picture', expected: false },
    { sessionType: 'guide', expected: false },
  ])('returns $expected for $sessionType sessions', ({ sessionType, expected }) => {
    expect(supportsSessionGeneration(sessionType)).toBe(expected)
  })

  it('uses a safe read-only default for unknown persisted values', () => {
    expect(supportsSessionGeneration('unknown' as SessionType)).toBe(false)
  })
})
