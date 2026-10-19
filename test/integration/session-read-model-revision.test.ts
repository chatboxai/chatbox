import { QueryKeys } from '@chatbox/react/query'
import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acknowledge, drivers, message, setupRows, source, type Driver } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
async function setup(driver: Driver) {
  const h = await setupRows(driver, {
    ...source(),
    messages: Array.from({ length: 120 }, (_, i) => message(`m${i}`, i === 119 ? 'assistant' : 'user')),
  })
  cleanup.push(h.dispose)
  return h
}

describe.each(drivers)('revision-owned header and transcript on %s', (driver) => {
  it('opens only the tail page and applies commands without fetching historical payloads', async () => {
    const h = await setup(driver)
    const snapshot = vi.spyOn(h.rows, 'readSnapshot')
    const read = vi.spyOn(h.repository, 'readSessionTranscriptWindow')
    const window = await h.openWindow(20)
    expect(window.getSnapshot().rows.map((r) => r.messageId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `m${100 + i}`)
    )
    await h.service.updateMessage('s', 'm119', { contentParts: [{ type: 'text', text: 'Edited' }] })
    await h.service.updateSessionHeader('s', { name: 'Renamed' })
    await h.service.insertMessage('s', message('next'))
    expect(window.getSnapshot().revision).toBe(await h.rows.getRevision('s'))
    expect(window.getSnapshot().rows[0].messageId).toBe('m100')
    expect(window.getSnapshot().rows.at(-1)?.messageId).toBe('next')
    expect(window.getSnapshot().rows.find((row) => row.messageId === 'm119')?.message.contentParts).toEqual([
      { type: 'text', text: 'Edited' },
    ])
    expect(window.getSnapshot().hasNewer).toBe(false)
    expect(window.getSnapshot().pages.map((page) => page.messages.length)).toEqual([20, 1])
    expect(read).toHaveBeenCalledTimes(1)
    expect(snapshot).not.toHaveBeenCalled()
    const header = await h.application.queryClient.fetchQuery(h.application.sessionQueryBridge.definitions.header('s'))
    expect(header?.header.name).toBe('Renamed')
    expect(header?.header).not.toHaveProperty('messages')
  })

  it('preserves live content through header updates and checkpoints, then replaces it with terminal rows', async () => {
    const h = await setup(driver)
    await h.service.updateMessage('s', 'm119', { generating: true })
    const window = await h.openWindow()
    const bridge = h.application.sessionQueryBridge
    const observer = new QueryObserver(h.application.queryClient, bridge.definitions.message('s', 'm119'))
    const unsubscribe = observer.subscribe(() => {})
    cleanup.push(unsubscribe)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    await bridge.updateMessageCache('s', 'm119', { contentParts: [{ type: 'text', text: 'Live' }] })
    await h.service.updateMessage('s', 'm119', {
      generating: true,
      contentParts: [{ type: 'text', text: 'Checkpoint' }],
    })
    await h.service.updateSessionHeader('s', { starred: true })
    expect(window.getSnapshot().rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text: 'Live' }])
    expect((await h.readMessage('m119'))?.contentParts).toEqual([{ type: 'text', text: 'Checkpoint' }])
    await h.service.updateMessage('s', 'm119', {
      generating: false,
      finishReason: 'stop',
      contentParts: [{ type: 'text', text: 'Final' }],
    })
    expect(window.getSnapshot().rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text: 'Final' }])
    const cached = h.application.queryClient.getQueryData<{ message: { contentParts: unknown } }>(
      QueryKeys.ChatSessionMessage('s', 'm119')
    )
    expect(cached?.message.contentParts).toEqual([{ type: 'text', text: 'Final' }])
  })

  it('keeps the window independent of query cache collection', async () => {
    const h = await setup(driver)
    const window = await h.openWindow()
    const read = vi.spyOn(h.repository, 'readSessionTranscriptWindow')
    for (let i = 0; i < 3; i++) {
      h.application.queryClient.clear()
      await h.application.sessionQueryBridge.updateMessageCache('s', 'm119', {
        contentParts: [{ type: 'text', text: `Live ${i}` }],
      })
      expect(window.getSnapshot().rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text: `Live ${i}` }])
    }
    expect(read).not.toHaveBeenCalled()
    expect(window.getSnapshot().rows).toHaveLength(20)
  })

  it('fences a slow page response when a newer local command commits', async () => {
    const h = await setup(driver)
    const window = await h.openWindow()
    const original = h.repository.readSessionTranscriptWindow.bind(h.repository)
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let readStarted!: () => void
    const started = new Promise<void>((resolve) => {
      readStarted = resolve
    })
    vi.spyOn(h.repository, 'readSessionTranscriptWindow').mockImplementationOnce(async (request) => {
      const page = await original(request)
      readStarted()
      await waiting
      return page
    })
    const pending = window.loadOlder(1)
    await started
    await h.service.updateMessage('s', 'm119', {
      generating: false,
      contentParts: [{ type: 'text', text: 'Committed' }],
    })
    release()
    await pending
    expect(window.getSnapshot().revision).toBe(await h.rows.getRevision('s'))
    expect(window.getSnapshot().rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text: 'Committed' }])
  })

  it('recovers navigation after another repository changes the source revision', async () => {
    const h = await setup(driver)
    const window = await h.openWindow()
    const other = h.createRepository()
    await other.executeSessionCommand('s', {
      type: 'update',
      messageId: 'm50',
      updater: { contentParts: [{ type: 'text', text: 'External' }] },
    })
    expect(await window.openSearch('m50')).toBe(true)
    expect(window.getSnapshot().rows[0].message.contentParts).toEqual([{ type: 'text', text: 'External' }])
    expect(window.getSnapshot().revision).toBe(await h.rows.getRevision('s'))
    acknowledge(window)
  })

  it('does not revive a deleted session when a late live update arrives', async () => {
    const h = await setup(driver)
    const window = await h.openWindow()
    await h.service.deleteSession('s')
    await h.application.sessionQueryBridge.updateMessageCache('s', 'm119', {
      contentParts: [{ type: 'text', text: 'Late' }],
    })
    expect(window.getSnapshot().rows).toHaveLength(0)
    expect(await h.repository.getSessionHeader('s')).toBeNull()
  })
})
