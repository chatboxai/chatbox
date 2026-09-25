/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
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

import type { Session } from '@shared/types'
import { analyzeContextTokens } from '@/packages/token-estimation/analyzer'
import { computationQueue } from '@/packages/token-estimation/computation-queue'
import queryClient from '@/stores/queryClient'
import { type ContextTokenSource, getContextMessagesForTokenEstimation, useContextTokens } from './context-tokens'

function createSessionWithoutTokenCache(): Session {
  return {
    id: 'test-session',
    name: 'Test',
    messages: [
      { id: 'msg-1', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: 'msg-2', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] },
    ],
    compactionPoints: [],
    settings: {},
  } as Session
}

let testQueryClient: QueryClient

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: testQueryClient }, children)
}

describe('context-tokens integration tests', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    computationQueue._reset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    computationQueue._reset()
    vi.restoreAllMocks()
  })

  it('no recalculation on re-render when deps unchanged', () => {
    const enqueueSpy = vi.spyOn(computationQueue, 'enqueueBatch')
    const session = createSessionWithoutTokenCache()

    const { rerender } = renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          source: { candidateMessages: session.messages, compactionPoints: session.compactionPoints },
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    const initialCallCount = enqueueSpy.mock.calls.length

    rerender()

    expect(enqueueSpy.mock.calls.length).toBe(initialCallCount)
  })

  it.each([false, true])(
    'publishes partial and intermediate counts with identical final attachment/compaction semantics (sandbox=%s)',
    (sandboxMode) => {
      const enqueue = vi.spyOn(computationQueue, 'enqueueBatch').mockImplementation(() => {})
      const session: Session = {
        id: 'progress',
        name: 'Progress',
        type: 'chat',
        messages: [
          {
            id: 'old',
            role: 'user',
            contentParts: [{ type: 'text', text: 'Old history' }],
            tokenCountMap: { default: 999 },
            tokenCalculatedAt: { default: 1 },
          },
          { id: 'boundary', role: 'assistant', contentParts: [{ type: 'text', text: 'Old answer' }] },
          {
            id: 'summary',
            role: 'assistant',
            isSummary: true,
            contentParts: [{ type: 'text', text: 'Summary' }],
            tokenCountMap: { default: 10 },
            tokenCalculatedAt: { default: 1 },
          },
          {
            id: 'tail',
            role: 'user',
            contentParts: [{ type: 'text', text: 'Current question' }],
            files: [
              {
                id: 'file',
                name: 'notes.txt',
                fileType: 'text/plain',
                storageKey: 'notes',
                lineCount: 1000,
                byteLength: 8000,
                tokenCountMap: { default: 800, default_preview: 80 },
                tokenCalculatedAt: { default: 1, default_preview: 1 },
              },
            ],
          },
        ],
        compactionPoints: [{ boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 1 }],
      }
      const initialProps: { source: ContextTokenSource } = {
        source: { candidateMessages: [session.messages[3]], isPartial: true },
      }
      const view = renderHook(
        ({ source }: { source: ContextTokenSource }) =>
          useContextTokens({
            sessionId: session.id,
            source,
            settings: {},
            modelSupportToolUseForFile: true,
            sandboxMode,
          }),
        { initialProps }
      )
      try {
        expect(view.result.current.contextTokens).toBeGreaterThan(0)
        expect(view.result.current.isContextCalculating).toBe(true)
        expect(view.result.current.isContextApproximate).toBe(true)
        expect(enqueue).not.toHaveBeenCalled()
        expect(queryClient.setQueryData).not.toHaveBeenCalled()
        view.rerender({ source: { candidateMessages: session.messages, compactionPoints: session.compactionPoints } })
        const intermediate = view.result.current.contextTokens
        expect(intermediate).toBeGreaterThan(0)
        expect(view.result.current.isContextCalculating).toBe(true)
        expect(enqueue).toHaveBeenCalledTimes(1)
        expect(queryClient.setQueryData).not.toHaveBeenCalled()
        const completed: Session = {
          ...session,
          messages: session.messages.map((message) =>
            message.id === 'tail'
              ? { ...message, tokenCountMap: { default: 20 }, tokenCalculatedAt: { default: 1 } }
              : message
          ),
        }
        view.rerender({
          source: { candidateMessages: completed.messages, compactionPoints: completed.compactionPoints },
        })
        const final = analyzeContextTokens({
          contextMessages: getContextMessagesForTokenEstimation(completed),
          tokenizerType: 'default',
          modelSupportToolUseForFile: true,
          sandboxMode,
        })
        expect(view.result.current.contextTokens).toBe(
          Object.values(final.breakdown).reduce((sum, count) => sum + count, 0)
        )
        expect(view.result.current.contextTokens).toBe(intermediate + 20)
        expect(view.result.current.isContextCalculating).toBe(false)
        expect(view.result.current.isContextApproximate).toBe(false)
      } finally {
        view.unmount()
      }
    }
  )
})
