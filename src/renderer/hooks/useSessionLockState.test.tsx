// @vitest-environment jsdom
import { IDLE_SESSION_LOCK_STATE } from '@chatbox/core/session/action-gates'
import type { useSessionGenerationControl } from '@chatbox/react/query'
import { act, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import { useSessionLockState } from './useSessionLockState'

type Options = Parameters<typeof useSessionGenerationControl>[0]
const mocks = vi.hoisted(() => ({
  version: 0,
  activeIds: new Set<string>(),
  control: vi.fn((options: Options) => ({
    locks: {
      generatingReplyCount: 0,
      anyReplyGenerating: false,
      awaitingPauseDecision: false,
      compactionRunning: options.compactionRunning,
    },
  })),
  header: vi.fn(() => ({ read: undefined })),
  source: { readSessionGenerationControl: vi.fn() },
  bridge: {},
}))
vi.mock('@chatbox/react/query', () => ({ useSessionGenerationControl: mocks.control }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    generationHooks: { useVersion: () => mocks.version },
    generationRuntime: { getActiveMessageIds: () => mocks.activeIds },
    sessionHooks: { useSessionHeader: mocks.header },
    sessions: mocks.source,
    sessionQueryBridge: mocks.bridge,
  },
}))

describe('row session controls host', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.version = 0
    mocks.activeIds = new Set()
    getDefaultStore().set(compactionUIStateMapAtom, {})
  })

  test('passes an absent identity to the shared idle control', () => {
    const { result } = renderHook(() => useSessionLockState(null))
    expect(result.current).toEqual(IDLE_SESSION_LOCK_STATE)
    expect(mocks.header).toHaveBeenCalledWith(null)
    expect(mocks.control.mock.calls[0]?.[0].activeGenerationMessageIds.size).toBe(0)
  })

  test('uses the presentation identity while the first header is pending', () => {
    const { result } = renderHook(() => useSessionLockState(undefined, 'session-1'))
    expect(result.current.compactionRunning).toBe(false)
    expect(mocks.control.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'session-1',
      headerRead: undefined,
      source: mocks.source,
      bridge: mocks.bridge,
    })
  })

  test('passes exact runtime identities independently of loaded message bodies', () => {
    mocks.activeIds = new Set(['active-reply', 'inactive-branch-reply'])
    const { rerender } = renderHook(() => useSessionLockState({ id: 'session-1', name: 'Session' }))
    const initial = mocks.control.mock.lastCall?.[0].activeGenerationMessageIds
    expect(initial).toEqual(new Set(['active-reply', 'inactive-branch-reply']))
    rerender()
    expect(mocks.control.mock.lastCall?.[0].activeGenerationMessageIds).toBe(initial)
    mocks.version++
    mocks.activeIds = new Set(['active-reply'])
    rerender()
    expect(mocks.control.mock.lastCall?.[0].activeGenerationMessageIds).toEqual(new Set(['active-reply']))
  })

  test('subscribes only to the target session compaction state', () => {
    const { result } = renderHook(() => useSessionLockState(undefined, 'session-1'))
    act(() =>
      getDefaultStore().set(compactionUIStateMapAtom, {
        other: { status: 'running', error: null, streamingText: '', summaryMessageId: null },
      })
    )
    expect(result.current.compactionRunning).toBe(false)
    act(() =>
      getDefaultStore().set(compactionUIStateMapAtom, {
        'session-1': { status: 'running', error: null, streamingText: '', summaryMessageId: null },
      })
    )
    expect(result.current.compactionRunning).toBe(true)
  })
})
