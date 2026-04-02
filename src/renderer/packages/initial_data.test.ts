import { describe, expect, it } from 'vitest'
import { getChatBridgeSmokeInspectionSnapshot } from './initial_data'

describe('chatbridge smoke inspection snapshot', () => {
  it('publishes the live-seed and preset-session corpus without runtime storage access', () => {
    const snapshot = getChatBridgeSmokeInspectionSnapshot()

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.liveSeeds.map((fixture) => fixture.fixtureId)).toEqual([
      'lifecycle-tour',
      'degraded-completion-recovery',
      'platform-recovery',
      'chess-mid-game-board-context',
      'history-and-preview',
      'chess-runtime',
    ])
    expect(snapshot.presetSessions.map((session) => session.fixtureId)).toEqual([
      'lifecycle-tour',
      'degraded-completion-recovery',
      'platform-recovery',
      'chess-mid-game-board-context',
      'history-and-preview',
      'chess-runtime',
    ])
    expect(snapshot.presetSessions.every((session) => session.locales.includes('en'))).toBe(true)
    expect(snapshot.presetSessions.every((session) => session.locales.includes('cn'))).toBe(true)
  })
})
