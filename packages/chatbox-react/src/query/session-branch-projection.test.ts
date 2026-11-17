import type { Message, Session } from '@chatbox/core'
import {
  ForkService,
  SessionEventBus,
  SessionService,
  SessionWriteCoordinator,
} from '@chatbox/core/application/session'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { SessionQueryBridge } from './session-query-bridge'
import { SessionTranscriptWindowController } from './session-transcript-window'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }] }
}

async function harness(session: Session, pageSize: number) {
  const repository = new InMemorySessionRepository()
  await repository.seedSession(session)
  const events = new SessionEventBus()
  let sequence = 0
  const identity = { createId: () => `generated-${++sequence}`, now: () => 1 }
  const sessions = new SessionService(repository, new SessionWriteCoordinator(repository), events, identity)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const bridge = new SessionQueryBridge(queryClient, sessions, events)
  const read = vi.fn(sessions.readSessionTranscriptWindow.bind(sessions))
  const controller = new SessionTranscriptWindowController({
    sessionId: session.id,
    pageSize,
    source: { readTranscriptWindow: read },
  })
  const unregister = bridge.registerWindow(session.id, controller)
  const forks = new ForkService(sessions, identity)
  const acknowledge = async (ids: string[]) => {
    await vi.waitFor(() => {
      expect(controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(ids)
      expect(controller.getSnapshot().layout).not.toBeNull()
    })
    controller.acknowledgeLayout(controller.getSnapshot().layout!.requestId)
  }
  return {
    repository,
    controller,
    read,
    forks,
    acknowledge,
    dispose() {
      unregister()
      controller.close()
      bridge.dispose()
      queryClient.clear()
    },
  }
}

test.each([20, 50])('updates retained fork controls from durable metadata with page size %i', async (pageSize) => {
  const session: Session = {
    id: 'fork-projection',
    name: 'Fork projections',
    messages: [message('earlier', 'system'), message('pivot', 'user'), message('current', 'assistant')],
    messageForksHash: {
      pivot: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'current-branch', messages: [] },
          { id: 'saved-branch', messages: [message('saved', 'assistant')] },
        ],
      },
    },
  }
  const h = await harness(session, pageSize)
  const { repository, controller, read, forks, acknowledge } = h
  const pivot = () => controller.getSnapshot().rows.find((row) => row.messageId === 'pivot')!
  try {
    await controller.open('head')
    await acknowledge(['earlier', 'pivot', 'current'])
    const retainedBody = pivot().message
    const earlierRow = controller.getSnapshot().rows[0]
    expect(pivot().fork).toMatchObject({ count: 2, position: 0 })

    await forks.create(session.id, 'pivot')
    await acknowledge(['earlier', 'pivot'])
    expect(pivot().fork).toMatchObject({ count: 3, position: 2 })
    read.mockClear()

    await forks.switch(session.id, 'pivot', 'prev')
    await acknowledge(['earlier', 'pivot', 'saved'])
    const stored = await repository.rowStore.readMessageMetadata({
      sessionId: session.id,
      messageIds: ['pivot'],
      expectedRevision: controller.getSnapshot().revision!,
    })
    expect(stored).toMatchObject({ status: 'ready', rows: [{ fork: { count: 2, position: 1 } }] })
    if (stored?.status !== 'ready') throw new Error('Committed fork metadata is unavailable')
    expect(pivot().fork).toEqual(stored.rows[0].fork)
    expect(pivot().message).toBe(retainedBody)
    expect(controller.getSnapshot().rows[0]).toBe(earlierRow)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][0]).toMatchObject({ origin: { messageId: 'saved' }, limit: pageSize })

    await forks.switch(session.id, 'pivot', 'prev')
    await acknowledge(['earlier', 'pivot', 'current'])
    expect(pivot().fork).toMatchObject({ count: 2, position: 0 })
    expect(pivot().message).toBe(retainedBody)

    await forks.delete(session.id, 'pivot')
    await acknowledge(['earlier', 'pivot', 'saved'])
    expect(pivot().fork).toBeUndefined()
    expect(pivot().message).toBe(retainedBody)
    expect(controller.getSnapshot().rows[0]).toBe(earlierRow)
  } finally {
    h.dispose()
  }
})

test.each([20, 50])(
  'publishes an edited first pivot body in the retained prefix with page size %i',
  async (pageSize) => {
    const session: Session = {
      id: 'first-pivot-edit',
      name: 'First pivot edit',
      messages: [message('pivot', 'user'), message('answer', 'assistant')],
    }
    const h = await harness(session, pageSize)
    try {
      await h.controller.open('head')
      await h.acknowledge(['pivot', 'answer'])
      h.read.mockClear()
      const replacement = {
        ...message('replacement', 'user'),
        contentParts: [{ type: 'text' as const, text: 'Edited' }],
      }
      await h.forks.saveAndResend(session.id, 'pivot', replacement)
      await h.acknowledge(['pivot'])
      const stored = await h.repository.readSessionMessages({ sessionId: session.id, messageIds: ['pivot'] })
      expect(stored?.messages[0].contentParts).toEqual(replacement.contentParts)
      expect(h.controller.getSnapshot().rows[0].message.contentParts).toEqual(replacement.contentParts)
      expect(h.controller.getSnapshot().rows[0].fork).toMatchObject({ count: 2, position: 1 })
      expect(h.read).not.toHaveBeenCalled()
    } finally {
      h.dispose()
    }
  }
)
