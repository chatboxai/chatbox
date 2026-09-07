// @vitest-environment jsdom

import type { Session } from '@chatbox/core'
import {
  RowBackedSessionRepository,
  SessionEventBus,
  SessionService,
  SessionWriteCoordinator,
} from '@chatbox/core/application/session'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySessionRowStore } from '@chatbox/core/testing'
import { QueryKeys, SessionQueryBridge } from '@chatbox/react/query'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { computationQueue } from '../computation-queue'
import { useTokenEstimation } from '../hooks/useTokenEstimation'
import { resultPersister } from '../result-persister'
import { executeTask } from '../task-executor'

const { patchDerived, readMessages } = vi.hoisted(() => ({ patchDerived: vi.fn(), readMessages: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      patchSessionMessageDerivedData: patchDerived,
      readSessionMessages: readMessages,
    },
  },
}))
vi.mock('../draft-tokenizer-worker-client', () => ({ tokenizeDraftOffMainThread: vi.fn() }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  resultPersister.cancel()
  computationQueue._reset()
  vi.useRealTimers()
})

it('does not compute or persist exact text twice across partial commits and re-entry', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  computationQueue._reset()
  resultPersister.cancel()
  const rows = new InMemorySessionRowStore()
  const repository = Object.assign(
    new RowBackedSessionRepository({ rows, records: new InMemorySessionRecordStore() }),
    {
      meta: new InMemorySessionRepository().meta,
    }
  )
  const session: Session = {
    id: 's',
    name: 's',
    type: 'chat',
    messages: ['a', 'b', 'c'].map((id) => ({
      id,
      role: 'assistant',
      contentParts: [{ type: 'text', text: `text ${id}` }],
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80 },
      tokenCount: 20,
      tokensUsed: 120,
    })),
  }
  await repository.setSession(session)
  const events = new SessionEventBus()
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), events, {
    createId: () => 'new',
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const bridge = new SessionQueryBridge(client, service, events)
  const first = deferred()
  const second = deferred()
  patchDerived
    .mockReset()
    .mockImplementation(async (...args: Parameters<SessionService['patchSessionMessageDerivedData']>) => {
      await (patchDerived.mock.calls.length === 1 ? first : second).promise
      return service.patchSessionMessageDerivedData(...args)
    })
  readMessages.mockReset().mockImplementation(service.readSessionMessages.bind(service))
  const executions: string[] = []
  computationQueue.setExecutor(async (task) => {
    const result = await executeTask(task)
    if (!result.result) throw new Error('Expected exact task result')
    executions.push(task.messageId)
    resultPersister.addResult(result.result)
    return result
  })
  await client.fetchQuery(bridge.definitions.contextSource('s'))
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const mount = () =>
    renderHook(
      () => {
        const { data } = useQuery(bridge.definitions.contextSource('s'))
        return useTokenEstimation({
          sessionId: 's',
          constructedMessage: undefined,
          contextMessages: data?.candidateMessages ?? [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      },
      { wrapper }
    )
  let hook = mount()
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(executions).toHaveLength(3)
    expect(resultPersister.getPendingCount()).toBe(2)
    expect(patchDerived).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.resolve()
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(executions).toHaveLength(3)
    expect(client.getQueryData(QueryKeys.ChatSession('s'))).toBeUndefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(patchDerived).toHaveBeenCalledTimes(2)
    expect(resultPersister.getPendingCount()).toBe(0)
    hook.unmount()
    hook = mount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(executions).toHaveLength(3)
    await act(async () => {
      second.resolve()
      await resultPersister.flushNow()
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(patchDerived).toHaveBeenCalledTimes(2)
    expect(
      patchDerived.mock.calls.flatMap((call) => call[1].map((patch: { messageId: string }) => patch.messageId)).sort()
    ).toEqual(['a', 'b', 'c'])
    const persisted = await service.readSessionMessages({ sessionId: 's', messageIds: ['a', 'b', 'c'] })
    expect(persisted?.messages.every((message) => (message.tokenCountMap?.default ?? 0) > 0)).toBe(true)
    expect(persisted?.messages.map(({ usage, tokenCount, tokensUsed }) => ({ usage, tokenCount, tokensUsed }))).toEqual(
      session.messages.map(({ usage, tokenCount, tokensUsed }) => ({ usage, tokenCount, tokensUsed }))
    )
  } finally {
    hook.unmount()
    first.resolve()
    second.resolve()
    await resultPersister.flushNow()
    bridge.dispose()
    client.clear()
  }
})

it('allows a later missing-cache update to retry a failed exact handoff without an automatic retry loop', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(20_000)
  computationQueue._reset()
  resultPersister.cancel()
  const first = deferred()
  patchDerived.mockReset().mockImplementation(async (sessionId: string, patches: unknown[]) => {
    if (patchDerived.mock.calls.length === 1) {
      await first.promise
      throw new Error('write unavailable')
    }
    return { sessionId, previousRevision: 1, revision: 2, patches }
  })
  let executions = 0
  computationQueue.setExecutor(async (task) => {
    const result = await executeTask(task)
    if (!result.result) throw new Error('Expected exact result')
    executions++
    resultPersister.addResult(result.result)
    return result
  })
  const message: Session['messages'][number] = { id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'text' }] }
  const hook = renderHook(
    ({ messages }) =>
      useTokenEstimation({
        sessionId: 's',
        constructedMessage: undefined,
        contextMessages: messages,
        model: undefined,
        modelSupportToolUseForFile: false,
      }),
    { initialProps: { messages: [message] } }
  )
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(executions).toBe(1)
    hook.rerender({ messages: [{ ...message }] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(executions).toBe(1)
    await act(async () => {
      first.resolve()
      await resultPersister.flushNow()
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(executions).toBe(1)
    hook.rerender({ messages: [{ ...message, timestamp: 2 }] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
      await resultPersister.flushNow()
    })
    expect(executions).toBe(2)
    expect(patchDerived).toHaveBeenCalledTimes(2)
  } finally {
    hook.unmount()
    first.resolve()
    await resultPersister.flushNow()
  }
})
