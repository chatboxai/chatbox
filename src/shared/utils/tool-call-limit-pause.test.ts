import { describe, expect, it } from 'vitest'
import { shouldPauseOnToolCallLimit } from './tool-call-limit-pause'

describe('shouldPauseOnToolCallLimit', () => {
  it('pauses by default when neither setting is present', () => {
    expect(shouldPauseOnToolCallLimit(undefined, undefined)).toBe(true)
    expect(shouldPauseOnToolCallLimit({}, {})).toBe(true)
    expect(shouldPauseOnToolCallLimit({ pauseOnToolCallLimit: undefined }, { pauseOnToolCallLimit: undefined })).toBe(
      true
    )
  })

  it('follows the global setting when the session does not override it', () => {
    expect(shouldPauseOnToolCallLimit({}, { pauseOnToolCallLimit: false })).toBe(false)
    expect(shouldPauseOnToolCallLimit({}, { pauseOnToolCallLimit: true })).toBe(true)
    expect(shouldPauseOnToolCallLimit(undefined, { pauseOnToolCallLimit: false })).toBe(false)
  })

  it('lets the session setting override the global one in both directions', () => {
    expect(shouldPauseOnToolCallLimit({ pauseOnToolCallLimit: false }, { pauseOnToolCallLimit: true })).toBe(false)
    expect(shouldPauseOnToolCallLimit({ pauseOnToolCallLimit: true }, { pauseOnToolCallLimit: false })).toBe(true)
    expect(shouldPauseOnToolCallLimit({ pauseOnToolCallLimit: false }, undefined)).toBe(false)
  })

  it('lets full access override the global default so unattended runs are not stalled', () => {
    expect(shouldPauseOnToolCallLimit({ commandApprovalMode: 'full_access' }, { pauseOnToolCallLimit: true })).toBe(
      false
    )
    expect(shouldPauseOnToolCallLimit({ commandApprovalMode: 'full_access' }, undefined)).toBe(false)
    // Older clients only ever wrote the legacy flag.
    expect(shouldPauseOnToolCallLimit({ agentFullAccess: true }, { pauseOnToolCallLimit: true })).toBe(false)
  })

  it('keeps an explicit per-chat choice above full access', () => {
    expect(
      shouldPauseOnToolCallLimit({ commandApprovalMode: 'full_access', pauseOnToolCallLimit: true }, undefined)
    ).toBe(true)
    expect(
      shouldPauseOnToolCallLimit(
        { commandApprovalMode: 'full_access', pauseOnToolCallLimit: true },
        { pauseOnToolCallLimit: false }
      )
    ).toBe(true)
    expect(shouldPauseOnToolCallLimit({ agentFullAccess: true, pauseOnToolCallLimit: true }, undefined)).toBe(true)
    expect(
      shouldPauseOnToolCallLimit({ commandApprovalMode: 'full_access', pauseOnToolCallLimit: false }, undefined)
    ).toBe(false)
  })

  it('still pauses in non-full-access modes', () => {
    expect(shouldPauseOnToolCallLimit({ commandApprovalMode: 'smart' }, { pauseOnToolCallLimit: true })).toBe(true)
    expect(shouldPauseOnToolCallLimit({ commandApprovalMode: 'always_ask' }, undefined)).toBe(true)
    expect(shouldPauseOnToolCallLimit({ agentFullAccess: false }, undefined)).toBe(true)
    expect(shouldPauseOnToolCallLimit({}, { pauseOnToolCallLimit: true })).toBe(true)
  })
})
