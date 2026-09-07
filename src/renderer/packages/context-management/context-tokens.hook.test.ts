/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/queryClient', () => {
  const mockClient = {
    setQueryDefaults: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  }
  return { default: mockClient, queryClient: mockClient }
})

vi.mock('@/packages/token-estimation/hooks/useTokenEstimation', () => ({
  useTokenEstimation: vi.fn(() => ({
    contextTokens: 50000,
    currentInputTokens: 100,
    totalTokens: 50100,
    isCalculating: false,
    isDraftCalculating: false,
    isCurrentInputApproximate: false,
    isTotalApproximate: false,
    isContextApproximate: false,
    isContextCalculating: false,
    pendingTasks: 0,
    pendingContextMessages: 0,
  })),
}))

vi.mock('@/packages/token-estimation', () => ({
  getTokenizerType: vi.fn((model?: { provider: string; modelId: string }) => {
    if (model?.provider === 'deepseek') return 'deepseek'
    return 'default'
  }),
}))

import type { Session } from '@shared/types'
import { getTokenizerType } from '@/packages/token-estimation'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'
import queryClient from '@/stores/queryClient'
import { type ContextTokensCacheValue, getContextTokensCacheKey, useContextTokens } from './context-tokens'

function createTestSession(overrides?: Partial<Session>): Session {
  return {
    id: 'test-session',
    name: 'Test Session',
    messages: [
      { id: 'msg-1', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: 'msg-2', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] },
    ],
    compactionPoints: [],
    settings: {},
    ...overrides,
  } as Session
}

let testQueryClient: QueryClient

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: testQueryClient }, children)
}

describe('context-tokens hook tests', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.clearAllMocks()
  })

  afterEach(() => {
    testQueryClient.clear()
  })

  it('cache key consistency - InputBox and Compaction generate same key', () => {
    const session = createTestSession()
    const params = {
      sessionId: session.id,
      maxContextMessageCount: Number.MAX_SAFE_INTEGER,
      latestContextMessageId: 'msg-2',
      latestCompactionBoundaryId: null,
      tokenizerType: 'default' as const,
    }

    const key1 = getContextTokensCacheKey(params)
    const key2 = getContextTokensCacheKey(params)

    expect(key1).toEqual(key2)
  })

  it('cache population - useContextTokens writes to cache', async () => {
    const session = createTestSession()

    const { result } = renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.isCalculating).toBe(false)
    })

    expect(queryClient.setQueryData).toHaveBeenCalled()
  })

  it('uses existing cache during recalculation (isCalculating=true)', () => {
    const session = createTestSession()
    getContextTokensCacheKey({
      sessionId: 'test-session',
      maxContextMessageCount: Number.MAX_SAFE_INTEGER,
      latestContextMessageId: 'msg-2',
      latestCompactionBoundaryId: null,
      tokenizerType: 'default',
    })

    vi.mocked(queryClient.getQueryData).mockReturnValue({
      contextTokens: 50000,
      messageCount: 2,
      timestamp: Date.now() - 5000,
    } satisfies ContextTokensCacheValue)

    vi.mocked(useTokenEstimation).mockReturnValue({
      contextTokens: 100,
      currentInputTokens: 0,
      totalTokens: 100,
      isCalculating: true,
      isDraftCalculating: false,
      isCurrentInputApproximate: false,
      isTotalApproximate: true,
      isContextApproximate: false,
      isContextCalculating: true,
      pendingTasks: 5,
      pendingContextMessages: 2,
      exactDraftTokens: null,
      breakdown: {
        currentInput: { text: 0, attachments: 0, toolCalls: 0 },
        context: { text: 100, attachments: 0, toolCalls: 0 },
      },
    })

    const { result } = renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: true,
        }),
      { wrapper: createWrapper() }
    )

    expect(result.current.contextTokens).toBe(50000)
    expect(result.current.isCalculating).toBe(true)
    expect(result.current.isContextCalculating).toBe(true)
  })

  it('completes the context cache while only the draft is calculating', () => {
    const session = createTestSession()
    vi.mocked(queryClient.getQueryData).mockReturnValue({
      contextTokens: 50000,
      messageCount: 2,
      timestamp: Date.now() - 5000,
    } satisfies ContextTokensCacheValue)
    vi.mocked(useTokenEstimation).mockReturnValue({
      contextTokens: 50000,
      currentInputTokens: 100,
      totalTokens: 50100,
      isCalculating: true,
      isDraftCalculating: true,
      isCurrentInputApproximate: true,
      isTotalApproximate: true,
      isContextApproximate: false,
      isContextCalculating: false,
      pendingTasks: 1,
      pendingContextMessages: 0,
      exactDraftTokens: null,
      breakdown: {
        currentInput: { text: 100, attachments: 0, toolCalls: 0 },
        context: { text: 50000, attachments: 0, toolCalls: 0 },
      },
    })

    const { result } = renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    expect(result.current.contextTokens).toBe(50000)
    expect(result.current.isCalculating).toBe(true)
    expect(result.current.isDraftCalculating).toBe(true)
    expect(result.current.isCurrentInputApproximate).toBe(true)
    expect(result.current.isTotalApproximate).toBe(true)
    expect(result.current.isContextCalculating).toBe(false)
    expect(result.current.pendingContextMessages).toBe(0)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ contextTokens: 50000, messageCount: 2 })
    )
  })

  it('tokenizerType consistency between InputBox and Compaction', () => {
    const model = { provider: 'deepseek', modelId: 'deepseek-chat' }

    // Both InputBox and Compaction use the same getTokenizerType function
    const inputBoxTokenizerType = getTokenizerType(model)
    const compactionTokenizerType = getTokenizerType(model)

    expect(inputBoxTokenizerType).toBe(compactionTokenizerType)
  })

  it('does not write to cache when sessionId is new', () => {
    const session = createTestSession()

    renderHook(
      () =>
        useContextTokens({
          sessionId: 'new',
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    expect(queryClient.setQueryData).not.toHaveBeenCalled()
  })

  it('does not write to cache when session is null', () => {
    renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          session: null,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    expect(queryClient.setQueryData).not.toHaveBeenCalled()
  })
})
