// @vitest-environment jsdom
import type { Session } from '@chatbox/core'
import { contextSourceFromSession } from '@chatbox/core/application/session'
import type { SessionReadModel } from '@chatbox/core/ports'
import { encodeSessionTree } from '@chatbox/core/session/session-tree'
import { createSessionHooks, createSessionQueryDefinitions, QueryKeys } from '@chatbox/react/query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { useSessionTokenContext } from './useSessionTokenContext'

const { contextHook } = vi.hoisted(() => ({ contextHook: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionHooks: { useSessionContextSource: (...args: unknown[]) => contextHook(...args) } },
}))

test('mounting estimation with a transcript window reads context only; full views reuse their snapshot', async () => {
  const session: Session = { id: 's', name: 's', type: 'chat', messages: [{ id: 'm', role: 'user', contentParts: [] }] }
  const encoded = encodeSessionTree(session, { activeThreadId: 's', now: 1 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const model: SessionReadModel = {
    kind: 'window',
    header: { id: 's', name: 's' },
    summary: encoded.tree.session.presentation!,
    window: {
      record: encoded.tree.session,
      revision: 1,
      thread: encoded.tree.threads[0],
      messages: encoded.tree.messages,
      older: null,
      newer: null,
    },
  }
  const source = contextSourceFromSession(session, { sessionId: 's' })
  const fullRead = vi.fn(async () => session)
  let resolveSource!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveSource = resolve
  })
  const contextRead = vi.fn(async () => {
    await ready
    return source
  })
  const page = async () => ({ items: [], nextCursor: null, total: 0 })
  const hooks = createSessionHooks(
    createSessionQueryDefinitions({
      getSession: fullRead,
      getSessionContextSource: contextRead,
      listSessionsMetaPage: page,
      listArchivedSessionsMetaPage: page,
    })
  )
  contextHook.mockImplementation(hooks.useSessionContextSource)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const initialProps: { model: SessionReadModel | undefined } = { model: undefined }
  const { result, rerender, unmount } = renderHook(
    ({ model }: { model: SessionReadModel | undefined }) => useSessionTokenContext('s', model),
    { wrapper, initialProps }
  )
  expect(contextRead).not.toHaveBeenCalled()
  rerender({ model })
  expect(result.current?.candidateMessages).toEqual(session.messages)
  expect(result.current?.isPartial).toBe(true)
  await act(async () => {
    resolveSource()
  })
  await waitFor(() => expect(result.current?.candidateMessages).toEqual(session.messages))
  await waitFor(() => expect(result.current?.isPartial).not.toBe(true))
  expect(contextRead).toHaveBeenCalledTimes(1)
  expect(fullRead).not.toHaveBeenCalled()
  expect(client.getQueryData(QueryKeys.ChatSession('s'))).toBeUndefined()
  const complete = {
    ...session,
    messages: [...session.messages, { id: 'next', role: 'user' as const, contentParts: [] }],
  }
  rerender({ model: { kind: 'full', session: complete } })
  expect(result.current?.candidateMessages).toBe(complete.messages)
  expect(contextRead).toHaveBeenCalledTimes(1)
  expect(fullRead).not.toHaveBeenCalled()
  unmount()
  client.clear()
})

test('switching sessions discards the previous preview and ignores its late complete source', async () => {
  const make = (id: string) => {
    const session: Session = {
      id,
      name: id,
      type: 'chat',
      messages: [{ id: `${id}-message`, role: 'user', contentParts: [{ type: 'text', text: id }] }],
    }
    const encoded = encodeSessionTree(session, { activeThreadId: id, now: 1 })
    if (!encoded.ok) throw new Error(encoded.reason)
    const model: SessionReadModel = {
      kind: 'window',
      header: { id, name: id },
      summary: encoded.tree.session.presentation!,
      window: {
        record: encoded.tree.session,
        revision: 1,
        thread: encoded.tree.threads[0],
        messages: encoded.tree.messages,
        older: null,
        newer: null,
      },
    }
    let resolve!: () => void
    const ready = new Promise<void>((done) => {
      resolve = done
    })
    return { session, model, resolve, ready }
  }
  const first = make('first')
  const second = make('second')
  const page = async () => ({ items: [], nextCursor: null, total: 0 })
  const hooks = createSessionHooks(
    createSessionQueryDefinitions({
      getSession: vi.fn(async () => null),
      getSessionContextSource: async (request) => {
        const entry = request.sessionId === 'first' ? first : second
        await entry.ready
        return contextSourceFromSession(entry.session, request)
      },
      listSessionsMetaPage: page,
      listArchivedSessionsMetaPage: page,
    })
  )
  contextHook.mockImplementation(hooks.useSessionContextSource)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const view = renderHook(
    ({ id, model }: { id: string; model: SessionReadModel }) => useSessionTokenContext(id, model),
    {
      initialProps: { id: 'first', model: first.model },
      wrapper,
    }
  )
  try {
    expect(view.result.current?.candidateMessages[0].id).toBe('first-message')
    expect(view.result.current?.isPartial).toBe(true)
    view.rerender({ id: 'second', model: second.model })
    expect(view.result.current?.candidateMessages[0].id).toBe('second-message')
    await act(async () => {
      first.resolve()
    })
    expect(view.result.current?.candidateMessages[0].id).toBe('second-message')
    expect(view.result.current?.isPartial).toBe(true)
    await act(async () => {
      second.resolve()
    })
    await waitFor(() => expect(view.result.current?.isPartial).not.toBe(true))
    expect(view.result.current?.candidateMessages).toEqual(second.session.messages)
  } finally {
    view.unmount()
    first.resolve()
    second.resolve()
    client.clear()
  }
})
