import type { Session } from '@chatbox/core'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { SessionEventBus } from '@chatbox/core/application/session'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { SessionQueryBridge } from './session-query-bridge'
import { SessionTranscriptWindowController } from './session-transcript-window'

async function fixture(count = 60, session?: Session) {
  const repository = new InMemorySessionRepository()
  await repository.seedSession(
    session ?? {
      id: 'removal',
      name: 'Removal',
      type: 'chat',
      messages: Array.from({ length: count }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 ? ('assistant' as const) : ('user' as const),
        contentParts: [{ type: 'text' as const, text: `Message ${i}` }],
      })),
    }
  )
  const events = new SessionEventBus()
  const client = new QueryClient()
  const bridge = new SessionQueryBridge(
    client,
    Object.assign(repository, {
      listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
      listArchivedSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
    }),
    events
  )
  const read = vi.spyOn(repository, 'readSessionTranscriptWindow')
  const controller = new SessionTranscriptWindowController({
    sessionId: 'removal',
    pageSize: 20,
    source: { readTranscriptWindow: read },
  })
  bridge.registerWindow('removal', controller)
  const acknowledge = () => {
    const layout = controller.getSnapshot().layout
    if (layout) controller.acknowledgeLayout(layout.requestId)
  }
  await controller.open()
  acknowledge()
  const remove = async (id: string) => {
    const result = await repository.executeSessionCommand('removal', {
      type: 'structure',
      operation: { action: 'message-remove', messageId: id, replacementPivotId: `pivot-${id}` },
    })
    if (result.kind !== 'rows') throw new Error('Missing commit')
    await events.publish({
      type: 'session-command-committed',
      delta: result.delta,
      meta: null,
      metaRevision: null,
      preserveCachedGeneratingMessages: true,
    })
    return result.delta
  }
  return {
    repository,
    read,
    controller,
    remove,
    acknowledge,
    dispose: () => {
      bridge.dispose()
      client.clear()
    },
  }
}

describe('committed transcript removal', () => {
  it.each(['m59', 'm58', 'm40', 'm39', 'm20', 'm10'])(
    'projects deletion of %s without a window read or dataset reset',
    async (id) => {
      const f = await fixture()
      try {
        await f.controller.loadOlder()
        f.acknowledge()
        const before = f.controller.getSnapshot()
        const reads = f.read.mock.calls.length
        const commit = await f.remove(id)
        const after = f.controller.getSnapshot()
        expect(f.read).toHaveBeenCalledTimes(reads)
        expect(after.windowEpoch).toBe(before.windowEpoch)
        expect(after.layout).toBeNull()
        expect(after.operation).toBeNull()
        expect(after.revision).toBe(commit.revision)
        expect(after.rows.map((row) => row.messageId)).toEqual(
          before.rows.filter((row) => row.messageId !== id).map((row) => row.messageId)
        )
        const last = after.rows.at(-1)!
        expect(last.activeChildId).toBeNull()
        for (let i = 1; i < after.rows.length; i++) {
          expect(after.rows[i].parentMessageId).toBe(after.rows[i - 1].messageId)
          expect(after.rows[i - 1].activeChildId).toBe(after.rows[i].messageId)
        }
        expect(await f.controller.loadOlder()).toBe(true)
        f.acknowledge()
        expect(f.controller.getSnapshot().operation).toBeNull()
        expect(f.controller.getSnapshot().rows.some((row) => row.messageId === id)).toBe(false)
      } finally {
        f.dispose()
      }
    }
  )
  it('deletes the only message without replacing the empty window', async () => {
    const f = await fixture(1)
    try {
      const epoch = f.controller.getSnapshot().windowEpoch
      await f.remove('m0')
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot()).toMatchObject({
        rows: [],
        windowEpoch: epoch,
        firstWindowReady: true,
        hasOlder: false,
        hasNewer: false,
        layout: null,
        operation: null,
      })
      expect(f.controller.getSnapshot().threads[0].rootMessageId).toBeNull()
    } finally {
      f.dispose()
    }
  })
  it.each(['pivot', 'active'])('retains the committed fork projection when removing %s', async (id) => {
    const message = (id: string) => ({ id, role: 'user' as const, contentParts: [{ type: 'text' as const, text: id }] })
    const f = await fixture(0, {
      id: 'removal',
      name: 'Fork removal',
      type: 'chat',
      messages: ['parent', 'pivot', 'active'].map(message),
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active-branch', messages: [] },
            { id: 'saved-branch', messages: [message('saved')] },
          ],
        },
      },
    })
    try {
      await f.remove(id)
      expect(f.read).toHaveBeenCalledTimes(1)
      const state = f.controller.getSnapshot()
      const actual = await f.repository.readSessionTranscriptWindow({ sessionId: 'removal', origin: 'tail', limit: 20 })
      expect(state.rows.map((row) => row.messageId)).toEqual(actual?.messages.map((row) => row.messageId))
      expect(state.rows.map((row) => [row.parentMessageId, row.activeChildId, row.fork])).toEqual(
        actual?.messages.map((row) => [row.parentMessageId, row.activeChildId, row.fork])
      )
    } finally {
      f.dispose()
    }
  })
  it('hydrates only the predecessor after deleting a sole oversized loaded message', async () => {
    const f = await fixture(0, {
      id: 'removal',
      name: 'Large tail',
      type: 'chat',
      messages: [
        { id: 'parent', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
        { id: 'huge', role: 'assistant', contentParts: [{ type: 'text', text: 'x'.repeat(2200000) }] },
      ],
    })
    try {
      expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['huge'])
      const branch = vi.spyOn(f.repository, 'readSessionBranchMessagesPage')
      await f.remove('huge')
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(branch).toHaveBeenCalledWith(expect.objectContaining({ firstMessageId: 'parent' }))
      expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['parent'])
    } finally {
      f.dispose()
    }
  })
  it('reports a revision gap without automatically re-reading the window', async () => {
    const f = await fixture()
    try {
      await f.repository.executeSessionCommand('removal', {
        type: 'header',
        updater: (header) => ({ ...header, id: 'removal', name: 'Updated' }),
      })
      await f.remove('m59')
      expect(f.read).toHaveBeenCalledTimes(1)
      expect(f.controller.getSnapshot().operation?.error?.message).toContain('out of date')
    } finally {
      f.dispose()
    }
  })
  it('lets explicit navigation supersede a delayed sibling hydration', async () => {
    const message = (id: string) => ({ id, role: 'user' as const, contentParts: [{ type: 'text' as const, text: id }] })
    const f = await fixture(0, {
      id: 'removal',
      name: 'Fork',
      type: 'chat',
      messages: ['parent', 'pivot', 'active'].map(message),
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'current', messages: [] },
            { id: 'saved', messages: [message('saved')] },
          ],
        },
      },
    })
    try {
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const read = f.repository.readSessionBranchMessagesPage
      vi.spyOn(f.repository, 'readSessionBranchMessagesPage').mockImplementationOnce(async (request) => {
        await held
        return read(request)
      })
      const removing = f.remove('active')
      await vi.waitFor(() =>
        expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['parent', 'pivot'])
      )
      expect(f.controller.getSnapshot().hasNewer).toBe(true)
      await f.controller.navigate('head')
      f.acknowledge()
      release()
      await removing
      expect(f.controller.getSnapshot().rows.map((row) => row.messageId)).toEqual(['parent', 'pivot'])
      expect(f.controller.getSnapshot().hasNewer).toBe(true)
      await f.controller.navigate('tail')
      f.acknowledge()
      expect(f.controller.getSnapshot().rows.at(-1)?.messageId).toBe('saved')
    } finally {
      f.dispose()
    }
  })
})
