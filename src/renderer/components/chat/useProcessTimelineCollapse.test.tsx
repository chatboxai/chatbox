// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useProcessTimelineCollapse } from './useProcessTimelineCollapse'

describe('useProcessTimelineCollapse', () => {
  test('starts collapsed in Work Mode and expanded in Chat Mode', () => {
    const workMode = renderHook(() => useProcessTimelineCollapse('work', false))
    const chatMode = renderHook(
      ({ generating }: { generating: boolean }) => useProcessTimelineCollapse('chat', generating),
      { initialProps: { generating: false } }
    )

    expect(workMode.result.current[0]).toBe(true)
    expect(chatMode.result.current[0]).toBe(false)

    chatMode.rerender({ generating: true })
    chatMode.rerender({ generating: false })
    expect(chatMode.result.current[0]).toBe(false)
  })

  test('preserves a manual expansion until the Work Mode reply runs again', () => {
    const { result, rerender } = renderHook(
      ({ generating }: { generating: boolean }) => useProcessTimelineCollapse('work', generating),
      { initialProps: { generating: false } }
    )

    act(() => result.current[1](false))
    rerender({ generating: false })
    expect(result.current[0]).toBe(false)

    rerender({ generating: true })
    expect(result.current[0]).toBe(true)

    rerender({ generating: false })
    expect(result.current[0]).toBe(true)
  })
})
