import type { Message } from '@chatbox/core'
import { snapshotStreamingMessage, StreamingWriteCoordinator } from '@chatbox/core/application/session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, message, setupRows, source, type Driver } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const assistant = (text: string, generating = true): Message => ({
  ...message('assistant', 'assistant'),
  generating,
  contentParts: [{ type: 'text', text }],
  ...(!generating ? { finishReason: 'stop' as const } : {}),
})
async function setup(driver: Driver) {
  const initial = { ...source(), messages: [message('earlier'), message('user'), assistant('A')] }
  const h = await setupRows(driver, initial)
  cleanup.push(h.dispose)
  const window = await h.openWindow(2)
  const bridge = h.application.sessionQueryBridge
  const scheduler = new StreamingWriteCoordinator()
  const stream = (value: Message) => {
    const snapshot = snapshotStreamingMessage(value)
    return scheduler.runCacheUpdate('s:assistant', (isCurrent) =>
      bridge.updateMessageCache('s', snapshot.id, snapshot, { shouldApply: isCurrent })
    )
  }
  const write = async (value: Message) => {
    await h.service.updateMessage('s', value.id, snapshotStreamingMessage(value))
  }
  const terminal = (value: Message) => scheduler.persistTerminal('s:assistant', () => write(value))
  const visible = () => window.getSnapshot().rows.find((row) => row.messageId === 'assistant')?.message
  const finish = async (text: string) => {
    await terminal(assistant(text, false))
    expect(await h.readMessage('assistant')).toMatchObject({
      generating: false,
      contentParts: [{ type: 'text', text }],
    })
    expect(visible()).toMatchObject({ generating: false, contentParts: [{ type: 'text', text }] })
    expect(await h.readMessage('earlier')).toEqual(initial.messages[0])
  }
  return { ...h, window, bridge, scheduler, stream, write, terminal, visible, finish }
}

describe.each(drivers)('streaming with bounded transcript windows on %s', (driver) => {
  it('continues streaming through repeated query cache collection', async () => {
    const h = await setup(driver)
    const read = vi.spyOn(h.repository, 'readSessionTranscriptWindow')
    for (const text of ['AB', 'ABC', 'ABCD']) {
      h.application.queryClient.clear()
      await h.stream(assistant(text))
      expect(h.visible()?.contentParts).toEqual([{ type: 'text', text }])
      expect(h.window.getSnapshot().rows).toHaveLength(2)
    }
    expect(read).not.toHaveBeenCalled()
    await h.finish('ABCDE')
  })

  it('does not regress live text when a slow checkpoint commits', async () => {
    const h = await setup(driver)
    const pause = deferred()
    const checkpoint = h.scheduler.scheduleCheckpoint('s:assistant', async () => {
      await pause.promise
      await h.write(assistant('AB'))
    })
    await h.stream(assistant('ABCD'))
    pause.resolve()
    await checkpoint
    expect((await h.readMessage('assistant'))?.contentParts).toEqual([{ type: 'text', text: 'AB' }])
    expect(h.visible()?.contentParts).toEqual([{ type: 'text', text: 'ABCD' }])
    await h.finish('ABCDE')
  })

  it('fences a delayed cache publication behind a terminal commit', async () => {
    const h = await setup(driver)
    const pause = deferred()
    const delayed = h.scheduler.runCacheUpdate('s:assistant', async (isCurrent) => {
      await pause.promise
      await h.bridge.updateMessageCache('s', 'assistant', assistant('AB'), { shouldApply: isCurrent })
    })
    await h.finish('Finished')
    pause.resolve()
    await delayed
    expect(h.visible()?.contentParts).toEqual([{ type: 'text', text: 'Finished' }])
  })

  it('publishes the newest chunk when cache updates complete out of order', async () => {
    const h = await setup(driver)
    const pause = deferred()
    const delayed = h.scheduler.runCacheUpdate('s:assistant', async (isCurrent) => {
      await pause.promise
      await h.bridge.updateMessageCache('s', 'assistant', assistant('AB'), { shouldApply: isCurrent })
    })
    await h.stream(assistant('ABCDE'))
    pause.resolve()
    await delayed
    expect(h.visible()?.contentParts).toEqual([{ type: 'text', text: 'ABCDE' }])
    await h.finish('ABCDEF')
  })

  it('persists a terminal reply after its page is evicted', async () => {
    const h = await setup(driver)
    expect(await h.window.openSearch('earlier')).toBe(true)
    expect(h.visible()).toBeUndefined()
    await h.stream(assistant('Invisible live chunk'))
    await h.terminal(assistant('Completed offscreen', false))
    expect(h.visible()).toBeUndefined()
    expect((await h.readMessage('assistant'))?.contentParts).toEqual([{ type: 'text', text: 'Completed offscreen' }])
    expect(await h.window.openSearch('assistant')).toBe(true)
    expect(h.visible()).toMatchObject({
      generating: false,
      contentParts: [{ type: 'text', text: 'Completed offscreen' }],
    })
  })

  it('keeps a later live reply while another reply completes', async () => {
    const h = await setup(driver)
    await h.service.insertMessage('s', { ...message('second', 'assistant'), generating: true })
    await h.bridge.updateMessageCache('s', 'second', { contentParts: [{ type: 'text', text: 'Second live' }] })
    await h.finish('First final')
    expect(h.window.getSnapshot().rows.find((row) => row.messageId === 'second')?.message.contentParts).toEqual([
      { type: 'text', text: 'Second live' },
    ])
    expect((await h.readMessage('second'))?.contentParts).toEqual([{ type: 'text', text: 'second' }])
  })

  it('does not resurrect deleted rows when a late cache publication arrives', async () => {
    const h = await setup(driver)
    await h.service.deleteSession('s')
    await h.stream(assistant('Late'))
    expect(h.window.getSnapshot().rows).toHaveLength(0)
    expect(await h.repository.getSessionHeader('s')).toBeNull()
  })
})
