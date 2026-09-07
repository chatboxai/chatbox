/**
 * @vitest-environment jsdom
 */
import type { SessionSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentModeSupported: false,
  getModel: vi.fn(),
  getRegistry: vi.fn(),
  registryVersion: 0,
  settingsState: {
    providers: {
      deepseek: {
        models: [{ modelId: 'deepseek-v4-flash', capabilities: undefined as string[] | undefined }],
      },
    },
  },
}))

vi.mock('@shared/providers', () => ({
  getModel: mocks.getModel,
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({})),
}))

vi.mock('@/packages/model-registry', () => ({
  getRegistry: mocks.getRegistry,
  useModelRegistryVersion: () => mocks.registryVersion,
}))

vi.mock('@/platform', () => ({
  default: { getConfig: vi.fn(async () => ({})) },
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({ getSettings: () => ({}) }),
  },
  useSettingsStore: (selector: (state: typeof mocks.settingsState) => unknown) => selector(mocks.settingsState),
}))

import { useModelToolCapabilities } from './useModelToolCapabilities'

let testQueryClient: QueryClient

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: testQueryClient }, children)
}

describe('useModelToolCapabilities', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.agentModeSupported = false
    mocks.registryVersion = 0
    mocks.getRegistry.mockReset().mockResolvedValue({})
    mocks.getModel.mockReset().mockImplementation(() => ({
      isSupportToolUse: (scope: string) => scope === 'agent' && mocks.agentModeSupported,
    }))
  })

  afterEach(() => {
    testQueryClient.clear()
  })

  it('does not report a false negative while the runtime registry is loading', async () => {
    let finishRegistryLoad: (() => void) | undefined
    mocks.getRegistry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRegistryLoad = resolve
        })
    )

    const { result } = renderHook(
      () =>
        useModelToolCapabilities({ provider: 'deepseek', modelId: 'deepseek-v4-flash' }, {
          provider: 'openai',
          modelId: 'gpt-5',
        } as SessionSettings),
      { wrapper: createWrapper() }
    )

    expect(result.current.modelSupportsAgentMode).toBe(true)
    expect(result.current.isModelToolCapabilityFetched).toBe(false)
    expect(mocks.getModel).not.toHaveBeenCalled()

    finishRegistryLoad?.()

    await waitFor(() => {
      expect(result.current.isModelToolCapabilityFetched).toBe(true)
    })
    expect(result.current.modelSupportsAgentMode).toBe(false)
    expect(mocks.getModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek', modelId: 'deepseek-v4-flash' }),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('rechecks capabilities when the runtime model registry changes', async () => {
    const { result, rerender } = renderHook(
      () => useModelToolCapabilities({ provider: 'deepseek', modelId: 'deepseek-v4-flash' }, {} as SessionSettings),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.modelSupportsAgentMode).toBe(false)
    })

    mocks.agentModeSupported = true
    mocks.registryVersion += 1
    rerender()

    await waitFor(() => {
      expect(result.current.modelSupportsAgentMode).toBe(true)
      expect(mocks.getModel).toHaveBeenCalledTimes(2)
    })
  })
})
