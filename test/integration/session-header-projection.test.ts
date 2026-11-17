import { QueryKeys } from '@chatbox/react/query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, message, setupRows, source } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
describe.each(drivers)('durable header projection on %s', (driver) => {
  it('writes metadata independently of a live message overlay', async () => {
    const h = await setupRows(driver, {
      ...source(),
      messages: [message('prompt'), { ...message('reply', 'assistant'), generating: true }],
    })
    cleanup.push(h.dispose)
    const window = await h.openWindow()
    await h.application.queryClient.fetchQuery(h.application.sessionQueryBridge.definitions.header('s'))
    await h.application.sessionQueryBridge.updateMessageCache('s', 'reply', {
      contentParts: [{ type: 'text', text: 'Live reply' }],
    })
    await h.service.updateSessionHeader('s', { name: 'Renamed', starred: true })
    expect((await h.repository.getSessionHeader('s'))?.header).toMatchObject({ name: 'Renamed', starred: true })
    expect(await h.meta.getById('s')).toMatchObject({ name: 'Renamed', starred: true })
    expect((await h.readMessage('reply'))?.contentParts).toEqual([{ type: 'text', text: 'reply' }])
    expect(window.getSnapshot().rows.at(-1)?.message.contentParts).toEqual([{ type: 'text', text: 'Live reply' }])
    const header = h.application.queryClient.getQueryData<{ header: unknown }>(QueryKeys.ChatSessionHeader('s'))
    expect(header?.header).toMatchObject({ name: 'Renamed' })
    expect(header?.header).not.toHaveProperty('messages')
  })
  it('retries a failed metadata projection without duplicating the durable row operation', async () => {
    const h = await setupRows(driver)
    cleanup.push(h.dispose)
    await h.service.updateSessionHeader('s', { name: 'Before' })
    const update = vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('metadata unavailable'))
    const apply = vi.spyOn(h.rows, 'applyDiff')
    await expect(h.service.insertMessage('s', message('new'))).resolves.toBeUndefined()
    expect(await h.readMessage('new')).toBeDefined()
    expect(apply).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
