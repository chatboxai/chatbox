// @vitest-environment jsdom

import { IDLE_SESSION_LOCK_STATE } from '@chatbox/core/session/action-gates'
import type { Session } from '@shared/types'
import { act, renderHook } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, test } from 'vitest'
import { rendererApplication } from '@/app/renderer-application'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import { useSessionLockState } from './useSessionLockState'

const generationRuntimeStore = rendererApplication.generationRuntime

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session',
    messages: [],
    ...overrides,
  }
}

describe('useSessionLockState', () => {
  beforeEach(() => {
    getDefaultStore().set(compactionUIStateMapAtom, {})
    generationRuntimeStore.clear('session-1')
  })

  test('returns the idle state without a session', () => {
    const { result } = renderHook(() => useSessionLockState(null))
    expect(result.current).toEqual(IDLE_SESSION_LOCK_STATE)
  })

  test('reports compaction only for the session it runs in', () => {
    getDefaultStore().set(compactionUIStateMapAtom, {
      'other-session': { status: 'running', error: null, streamingText: '', summaryMessageId: null },
    })

    const { result } = renderHook(() => useSessionLockState(session()))
    expect(result.current.compactionRunning).toBe(false)

    getDefaultStore().set(compactionUIStateMapAtom, {
      'session-1': { status: 'running', error: null, streamingText: '', summaryMessageId: null },
    })
    const { result: lockedResult } = renderHook(() => useSessionLockState(session()))
    expect(lockedResult.current.compactionRunning).toBe(true)
  })

  test('keeps the snapshot reference stable across value-equal re-derivations', () => {
    const streamingMessages = (text: string) => [
      { id: 'user', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'q' }] },
      {
        id: 'reply',
        role: 'assistant' as const,
        contentParts: [{ type: 'text' as const, text }],
        generating: true,
      },
    ]
    generationRuntimeStore.start('session-1', 'reply')

    // Each streaming chunk hands the hook a fresh session object; the lock
    // values are unchanged, so memo()'d consumers must get the same reference.
    const { result, rerender } = renderHook(({ current }: { current: Session }) => useSessionLockState(current), {
      initialProps: { current: session({ messages: streamingMessages('chunk 1') }) },
    })
    const first = result.current

    rerender({ current: session({ messages: streamingMessages('chunk 1 chunk 2') }) })
    expect(result.current).toBe(first)

    rerender({ current: session({ messages: [{ id: 'user', role: 'user', contentParts: [] }] }) })
    expect(result.current).not.toBe(first)
    expect(result.current.anyReplyGenerating).toBe(false)
  })

  test('derives generation locks from session messages', () => {
    generationRuntimeStore.start('session-1', 'reply')
    const { result } = renderHook(() =>
      useSessionLockState(
        session({
          messages: [
            { id: 'user', role: 'user', contentParts: [] },
            { id: 'reply', role: 'assistant', contentParts: [], generating: true },
          ],
        })
      )
    )

    expect(result.current.generatingReplyCount).toBe(1)
    expect(result.current.anyReplyGenerating).toBe(true)
  })

  test('updates cancellable reply counts from runtime subscriptions', () => {
    const current = session({
      messages: [{ id: 'reply', role: 'assistant', contentParts: [], generating: true }],
    })
    const { result } = renderHook(() => useSessionLockState(current))

    expect(result.current.anyReplyGenerating).toBe(true)
    expect(result.current.generatingReplyCount).toBe(0)

    act(() => {
      generationRuntimeStore.start('session-1', 'reply')
    })
    expect(result.current.generatingReplyCount).toBe(1)

    act(() => {
      generationRuntimeStore.beginStop('session-1', 'reply')
    })
    expect(result.current.generatingReplyCount).toBe(1)

    act(() => {
      generationRuntimeStore.clear('session-1', 'reply')
    })
    expect(result.current.generatingReplyCount).toBe(0)
  })
})
