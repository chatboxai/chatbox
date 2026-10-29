// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import type { UseTokenEstimationOptions } from '@/packages/token-estimation/hooks/useTokenEstimation'
import { describe, expect, it, vi } from 'vitest'
const read = vi.hoisted(() =>
  vi.fn((_options: UseTokenEstimationOptions) => ({
    contextTokens: 42,
    currentInputTokens: 3,
    totalTokens: 45,
    contextMessageCount: 11,
  }))
)
vi.mock('@/packages/token-estimation/hooks/useTokenEstimation', () => ({ useTokenEstimation: read }))
import { useContextTokens } from './context-tokens'
describe('context token row facade', () => {
  it('forwards only identity, policy and draft inputs to independent estimation', () => {
    const view = renderHook(() =>
      useContextTokens({
        sessionId: 's',
        revision: 17,
        enabled: false,
        settings: { maxContextMessageCount: 20 },
        modelSupportToolUseForFile: true,
        sandboxMode: true,
      })
    )
    expect(read.mock.calls[0][0]).toMatchObject({
      sessionId: 's',
      enabled: false,
      maxContextMessageCount: 20,
      sandboxMode: true,
    })
    expect(read.mock.calls[0][0]).not.toHaveProperty('contextMessages')
    expect(read.mock.calls[0][0]).not.toHaveProperty('source')
    expect(view.result.current.messageCount).toBe(11)
    view.unmount()
  })
})
