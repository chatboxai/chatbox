import type { Session } from '@chatbox/core'
import type { SessionStructureOperation } from '@chatbox/core/ports'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { SessionEventBus } from '@chatbox/core/application/session'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { SessionQueryBridge } from './session-query-bridge'
import { SessionTranscriptWindowController } from './session-transcript-window'

function messages(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    role: 'user' as const,
    contentParts: [{ type: 'text' as const, text: `${prefix}${index}` }],
  }))
}
async function fixture(session: Session = { id: 's', name: 'Threads', messages: messages('m', 60) }) {
  const repository = new InMemorySessionRepository()
  await repository.seedSession(session)
  const client = new QueryClient()
  const events = new SessionEventBus()
  const bridge = new SessionQueryBridge(
    client,
    Object.assign(repository, {
      listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
      listArchivedSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
    }),
    events
  )
  const readSource = repository.readSessionTranscriptWindow.bind(repository)
  const read = vi.spyOn(repository, 'readSessionTranscriptWindow')
  const controller = new SessionTranscriptWindowController({
    sessionId: 's',
    pageSize: 20,
    source: { readTranscriptWindow: read },
  })
  bridge.registerWindow('s', controller)
  const acknowledge = () => {
    const layout = controller.getSnapshot().layout
    if (layout) controller.acknowledgeLayout(layout.requestId)
  }
  await controller.open()
  acknowledge()
  const snapshots: ReturnType<typeof controller.getSnapshot>[] = []
  controller.subscribe(() => snapshots.push(controller.getSnapshot()))
  const command = async (operation: SessionStructureOperation) => {
    const result = await repository.executeSessionCommand('s', { type: 'structure', operation })
    if (result.kind !== 'rows') throw new Error('Missing rows commit')
    await events.publish({
      type: 'session-command-committed',
      delta: result.delta,
      meta: null,
      metaRevision: null,
      preserveCachedGeneratingMessages: true,
    })
    await vi.waitFor(() => expect(controller.getSnapshot().operation?.phase).not.toBe('reading'))
    return result.delta
  }
  const create = () =>
    command({
      action: 'thread-create',
      archiveId: 'new',
      systemMessageId: 'system-new',
      now: 1,
      defaultSystemPrompt: 'System',
    })
  const expectMounted = (epoch: number) => {
    expect(snapshots.length).toBeGreaterThan(0)
    for (const state of snapshots) {
      expect(state.pages.length).toBeGreaterThan(0)
      expect(state.windowEpoch).toBe(epoch)
      expect(state.firstWindowReady).toBe(true)
    }
  }
  return {
    repository,
    readSource,
    controller,
    read,
    command,
    create,
    acknowledge,
    snapshots,
    expectMounted,
    dispose: () => {
      bridge.dispose()
      client.clear()
    },
  }
}

describe('committed thread windows', () => {
  it('appends a new thread and removes it without reading or resetting the mounted window', async () => {
    const f = await fixture()
    try {
      const before = f.controller.getSnapshot()
      await f.create()
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().rows.slice(0, 20)).toEqual(before.rows)
      expect(f.controller.getSnapshot().rows[0]).toBe(before.rows[0])
      expect(f.controller.getSnapshot().rows.at(-1)?.messageId).toBe('system-new')
      expect(f.controller.getSnapshot().layout?.kind).toBe('tail')
      f.acknowledge()
      await f.command({ action: 'thread-delete', threadId: 'new' })
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().rows).toEqual(before.rows)
      f.expectMounted(before.windowEpoch)
      f.acknowledge()
      expect(await f.controller.loadOlder()).toBe(true)
      expect(f.controller.getSnapshot().rows[0].messageId).toBe('m20')
    } finally {
      f.dispose()
    }
  })

  it('removes a loaded historical thread and preserves the surrounding rows', async () => {
    const f = await fixture({
      id: 's',
      name: 'Threads',
      messages: messages('m', 4),
      threads: [
        { id: 'a', name: 'A', createdAt: 0, messages: messages('a', 4) },
        { id: 'b', name: 'B', createdAt: 1, messages: messages('b', 4) },
      ],
    })
    try {
      const before = f.controller.getSnapshot()
      await f.command({ action: 'thread-delete', threadId: 'b' })
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().rows).toEqual(before.rows.filter((row) => row.threadId !== 'b'))
      expect(f.controller.getSnapshot().threads.some((thread) => thread.threadId === 'b')).toBe(false)
      f.expectMounted(before.windowEpoch)
    } finally {
      f.dispose()
    }
  })

  it('keeps an empty mounted page after deleting the only thread contents', async () => {
    const f = await fixture({ id: 's', name: 'Threads', messages: messages('m', 3) })
    try {
      const before = f.controller.getSnapshot()
      await f.command({ action: 'thread-delete', threadId: before.pages[0].record.activeThreadId })
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().rows).toEqual([])
      expect(f.controller.getSnapshot().hasOlder).toBe(false)
      f.expectMounted(before.windowEpoch)
    } finally {
      f.dispose()
    }
  })

  it('creates a tail from committed rows while browsing history and keeps its older cursor valid', async () => {
    const f = await fixture()
    try {
      await f.controller.navigate('head')
      f.acknowledge()
      f.snapshots.length = 0
      const before = f.controller.getSnapshot()
      expect(before.hasNewer).toBe(true)
      const count = f.read.mock.calls.length
      await f.create()
      expect(f.read).toHaveBeenCalledTimes(count)
      expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['system-new'])
      expect(f.controller.getSnapshot().hasOlder).toBe(true)
      f.expectMounted(before.windowEpoch)
      f.acknowledge()
      await f.controller.loadOlder()
      expect(f.controller.getSnapshot().rows.at(-2)?.messageId).toBe('m59')
    } finally {
      f.dispose()
    }
  })

  it('loads an uncached surviving neighbor without publishing an empty window', async () => {
    const f = await fixture({
      id: 's',
      name: 'Threads',
      messages: messages('m', 25),
      threads: [{ id: 'a', name: 'A', createdAt: 0, messages: messages('a', 25) }],
    })
    try {
      const before = f.controller.getSnapshot()
      await f.command({ action: 'thread-delete', threadId: before.pages[0].record.activeThreadId })
      expect(f.read).toHaveBeenCalledTimes(2)
      expect(f.controller.getSnapshot().rows.at(-1)?.messageId).toBe('a24')
      f.expectMounted(before.windowEpoch)
    } finally {
      f.dispose()
    }
  })

  it('keeps earlier history reachable when deleting into an empty surviving thread', async () => {
    const f = await fixture({
      id: 's',
      name: 'Threads',
      messages: messages('m', 25),
      threads: [
        { id: 'a', name: 'A', createdAt: 0, messages: messages('a', 25) },
        { id: 'b', name: 'B', createdAt: 1, messages: [] },
      ],
    })
    try {
      const before = f.controller.getSnapshot()
      await f.command({ action: 'thread-delete', threadId: before.pages[0].record.activeThreadId })
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().rows).toEqual([])
      expect(f.controller.getSnapshot().hasOlder).toBe(true)
      f.expectMounted(before.windowEpoch)
      f.acknowledge()
      await f.controller.loadOlder()
      expect(f.controller.getSnapshot().rows.at(-1)?.messageId).toBe('a24')
    } finally {
      f.dispose()
    }
  })

  it('retains common branch messages and their dataset while reading the new suffix', async () => {
    const f = await fixture({
      id: 's',
      name: 'Branches',
      messages: messages('m', 3),
      messageForksHash: {
        m1: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved', messages: messages('saved', 3) },
          ],
        },
      },
    })
    try {
      const before = f.controller.getSnapshot()
      const original = f.readSource
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      f.read.mockImplementationOnce(async (request) => {
        const page = await original(request)
        await gate
        return page
      })
      const switching = f.command({ action: 'fork-switch', pivotId: 'm1', target: 'next' })
      try {
        await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2))
        expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(
          before.rows.map((row) => row.messageId)
        )
      } finally {
        release?.()
        await switching
      }
      const after = f.controller.getSnapshot()
      expect(f.read).toHaveBeenCalledTimes(2)
      expect(f.read.mock.lastCall?.[0].origin).toEqual({ messageId: 'saved0' })
      expect(after.operation?.error).toBeUndefined()
      expect(after.operation?.phase).toBe('layout')
      expect(after.rows[0]).toBe(before.rows[0])
      expect(after.rows.map((row) => row.messageId)).toEqual(['m0', 'm1', 'saved0', 'saved1', 'saved2'])
      expect(f.snapshots.every((state) => state.rows.some((row) => row.messageId === 'm0'))).toBe(true)
      expect(f.snapshots.every((state) => [3, 5].includes(state.rows.length))).toBe(true)
      f.expectMounted(before.windowEpoch)
    } finally {
      f.dispose()
    }
  })
})
