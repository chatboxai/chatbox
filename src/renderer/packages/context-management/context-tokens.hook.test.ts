// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'
import { useContextTokens } from './context-tokens'

vi.mock('@/packages/token-estimation/hooks/useTokenEstimation', () => ({
  useTokenEstimation: vi.fn(() => ({
    contextTokens: 123,
    currentInputTokens: 20,
    totalTokens: 143,
    isCalculating: true,
    isDraftCalculating: true,
    isCurrentInputApproximate: true,
    isTotalApproximate: true,
    isContextApproximate: false,
    isContextCalculating: false,
    pendingContextMessages: 0,
    pendingTasks: 1,
  })),
}))
it('forwards partial-source and live calculation state without treating draft work as context work', () => {
  const { result } = renderHook(() =>
    useContextTokens({
      sessionId: 's',
      source: { isPartial: true, candidateMessages: [] },
      settings: {},
      modelSupportToolUseForFile: false,
    })
  )
  expect(vi.mocked(useTokenEstimation).mock.calls.at(-1)?.[0].contextSourcePending).toBe(true)
  expect(result.current).toMatchObject({
    contextTokens: 123,
    totalTokens: 143,
    isDraftCalculating: true,
    isContextCalculating: false,
    isCurrentInputApproximate: true,
    pendingContextMessages: 0,
  })
})
it('does not submit history without a source', () => {
  renderHook(() => useContextTokens({ sessionId: 's', source: null, settings: {}, modelSupportToolUseForFile: false }))
  expect(vi.mocked(useTokenEstimation).mock.calls.at(-1)?.[0].contextMessages).toEqual([])
})
