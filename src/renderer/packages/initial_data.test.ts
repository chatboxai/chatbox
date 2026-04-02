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
      'chess-runtime',
      'history-and-preview',
    ])
    expect(snapshot.presetSessions.map((session) => session.fixtureId)).toEqual([
      'lifecycle-tour',
      'degraded-completion-recovery',
      'platform-recovery',
      'chess-mid-game-board-context',
      'chess-runtime',
      'history-and-preview',
    ])
    expect(snapshot.presetSessions.every((session) => session.locales.includes('en'))).toBe(true)
    expect(snapshot.presetSessions.every((session) => session.locales.includes('cn'))).toBe(true)
    expect(snapshot.liveSeeds.find((fixture) => fixture.fixtureId === 'chess-runtime')).toMatchObject({
      fixtureRole: 'active-flagship',
      smokeSupport: 'supported',
    })
    expect(snapshot.presetSessions.find((session) => session.fixtureId === 'history-and-preview')).toMatchObject({
      fixtureRole: 'legacy-reference',
      smokeSupport: 'legacy-reference',
    })
  })
})
