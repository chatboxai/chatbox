/** @vitest-environment jsdom */
import { cleanup, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'
import {
  sessionStartupRecovery,
  useSessionStartupGuard,
  useSessionStartupLoadTarget,
  useSessionStartupQueryFailure,
} from './session-startup-recovery'

describe('session startup guard', () => {
  afterEach(() => {
    cleanup()
    sessionStartupRecovery.clearForTests()
  })

  it('does not skip a session that settled after opening', () => {
    sessionStartupRecovery.begin('session-1')
    sessionStartupRecovery.settle('session-1')

    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(false)
    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(false)
  })

  it('skips auto-restore and records failure when the previous open never settled', () => {
    sessionStartupRecovery.begin('session-1')

    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(false)
    sessionStartupRecovery.abandon('session-1')
    localStorage.setItem(
      'chatbox.sessionStartupInflight',
      JSON.stringify({ sessionId: 'session-1', startedAt: Date.now() - 1000 })
    )
    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(true)
    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(true)
    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(true)
  })

  it('clears the failure after a later successful open', () => {
    sessionStartupRecovery.fail('session-1')
    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(true)

    sessionStartupRecovery.settle('session-1')

    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(false)
    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(false)
  })

  it('clears the archived session from automatic restore', () => {
    const store = getDefaultStore()
    store.set(currentSessionIdAtom, 'session-1')
    sessionStartupRecovery.fail('session-1')

    sessionStartupRecovery.completeArchive('session-1')

    expect(store.get(currentSessionIdAtom)).toBeNull()
    expect(localStorage.getItem('_currentSessionIdCachedAtom')).toBe('null')
    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(false)
  })

  it('forgets recovery state when a session is deleted', () => {
    sessionStartupRecovery.fail('session-1')
    sessionStartupRecovery.retry('session-1')

    sessionStartupRecovery.forget(['session-1'])

    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(false)
    expect(sessionStartupRecovery.getLoadTarget('session-1')).toBe('session-1')
  })

  it('ignores the new-chat route', () => {
    sessionStartupRecovery.begin('new')
    expect(sessionStartupRecovery.shouldSkipAutoRestore('new')).toBe(false)
    expect(sessionStartupRecovery.shouldSkipAutoRestore(null)).toBe(false)
  })

  it('keeps the guard inflight until the session UI commits', () => {
    const { rerender } = renderHook(
      ({ isReady }: { isReady: boolean }) => useSessionStartupGuard('session-1', isReady),
      { initialProps: { isReady: false } }
    )

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).not.toBeNull()

    rerender({ isReady: true })

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).toBeNull()
  })

  it('settles the guard when a successful session query returns not found', () => {
    const { rerender } = renderHook(
      ({ isSettled }: { isSettled: boolean }) => useSessionStartupGuard('missing-session', isSettled),
      { initialProps: { isSettled: false } }
    )

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).not.toBeNull()

    rerender({ isSettled: true })

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).toBeNull()
    expect(sessionStartupRecovery.isRecoveryRequired('missing-session')).toBe(false)
  })

  it('clears the current run inflight marker when the session UI unmounts before becoming ready', () => {
    const { unmount } = renderHook(() => useSessionStartupGuard('session-1', false))

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).not.toBeNull()

    unmount()

    expect(localStorage.getItem('chatbox.sessionStartupInflight')).toBeNull()
    expect(sessionStartupRecovery.shouldSkipAutoRestore('session-1')).toBe(false)
  })

  it('only loads the failed session that the user chose to retry', () => {
    sessionStartupRecovery.fail('session-1')
    sessionStartupRecovery.fail('session-2')
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionStartupLoadTarget(sessionId),
      { initialProps: { sessionId: 'session-1' } }
    )

    expect(result.current).toBeNull()

    act(() => sessionStartupRecovery.retry('session-1'))
    expect(result.current).toBe('session-1')

    rerender({ sessionId: 'session-2' })
    expect(result.current).toBeNull()

    rerender({ sessionId: 'session-1' })
    expect(result.current).toBeNull()
  })

  it('blocks a stale inflight session before its first query', () => {
    localStorage.setItem(
      'chatbox.sessionStartupInflight',
      JSON.stringify({ sessionId: 'session-1', startedAt: Date.now() - 1000 })
    )

    const { result } = renderHook(() => useSessionStartupLoadTarget('session-1'))

    expect(result.current).toBeNull()
  })

  it('keeps a promoted failed session blocked after another session settles', () => {
    localStorage.setItem(
      'chatbox.sessionStartupInflight',
      JSON.stringify({ sessionId: 'session-1', startedAt: Date.now() - 1000 })
    )
    sessionStartupRecovery.promotePreviousAttempt()

    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(true)
    sessionStartupRecovery.begin('session-2')
    sessionStartupRecovery.settle('session-2')

    const { result } = renderHook(() => useSessionStartupLoadTarget('session-1'))
    expect(result.current).toBeNull()
  })

  it('does not block the inflight attempt created by this app run', () => {
    const { result, rerender } = renderHook(() => useSessionStartupLoadTarget('session-1'))
    expect(result.current).toBe('session-1')

    sessionStartupRecovery.begin('session-1')
    rerender()

    expect(result.current).toBe('session-1')
  })

  it('returns to recovery when a retry query fails', () => {
    sessionStartupRecovery.fail('session-1')
    const { result, rerender } = renderHook(
      ({ isError }: { isError: boolean }) => {
        const sessionLoadTarget = useSessionStartupLoadTarget('session-1')
        useSessionStartupQueryFailure('session-1', sessionLoadTarget, isError)
        return sessionLoadTarget
      },
      { initialProps: { isError: false } }
    )

    expect(result.current).toBeNull()
    act(() => sessionStartupRecovery.retry('session-1'))
    expect(result.current).toBe('session-1')

    rerender({ isError: true })

    expect(result.current).toBeNull()
    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(true)
  })

  it('enters recovery immediately when the initial session query fails', () => {
    const { result, rerender } = renderHook(
      ({ isError }: { isError: boolean }) => {
        const sessionLoadTarget = useSessionStartupLoadTarget('session-1')
        useSessionStartupQueryFailure('session-1', sessionLoadTarget, isError)
        return sessionLoadTarget
      },
      { initialProps: { isError: false } }
    )

    expect(result.current).toBe('session-1')

    rerender({ isError: true })

    expect(result.current).toBeNull()
    expect(sessionStartupRecovery.isRecoveryRequired('session-1')).toBe(true)
  })
})
