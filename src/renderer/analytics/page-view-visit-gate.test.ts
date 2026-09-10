import { describe, expect, it } from 'vitest'
import { createPageViewVisitGate } from './page-view-visit-gate'

describe('page view visit gate', () => {
  it('does not count session recovery state changes as new visits', () => {
    const gate = createPageViewVisitGate()

    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(true)
    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(false)
    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(false)
  })

  it('tracks pathname and settings route state changes', () => {
    const gate = createPageViewVisitGate()

    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(true)
    expect(gate.shouldTrack('/session/session-2', undefined)).toBe(true)
    expect(gate.shouldTrack('/session/session-2', '/general')).toBe(true)
    expect(gate.shouldTrack('/session/session-2', undefined)).toBe(true)
  })

  it('tracks a return from an untracked route as a new visit', () => {
    const gate = createPageViewVisitGate()

    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(true)
    expect(gate.shouldTrack('/dev', undefined)).toBe(true)
    expect(gate.shouldTrack('/session/session-1', undefined)).toBe(true)
  })
})
