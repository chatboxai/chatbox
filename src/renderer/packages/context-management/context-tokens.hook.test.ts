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
it('forwards the first-window gate and independent draft calculation state', () => {
  const { result } = renderHook(() =>
    useContextTokens({
      sessionId: 's',
      enabled: false,
      revision: 2,
      settings: {},
      modelSupportToolUseForFile: false,
    })
  )
  expect(vi.mocked(useTokenEstimation).mock.calls.at(-1)?.[0].enabled).toBe(false)
  expect(result.current).toMatchObject({
    contextTokens: 123,
    totalTokens: 143,
    isDraftCalculating: true,
    isContextCalculating: false,
    isCurrentInputApproximate: true,
    pendingContextMessages: 0,
  })
})
it('enables independent history after the first window is ready', () => {
  renderHook(() => useContextTokens({ sessionId: 's', enabled: true, settings: {}, modelSupportToolUseForFile: false }))
  expect(vi.mocked(useTokenEstimation).mock.calls.at(-1)?.[0].enabled).toBe(true)
})
