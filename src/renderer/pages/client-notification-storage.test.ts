// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY,
  markBatchDisplayed,
  readDisplayedBatchIds,
  withWebNotificationDisplayLock,
} from './client-notification-storage'

describe('client notification displayed storage', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('holds the same origin lock until display finishes and releases it on failure', async () => {
    let queue = Promise.resolve()
    const request = vi.fn((_name: string, show: () => Promise<void>) => {
      const result = queue.then(show)
      queue = result.catch(() => undefined)
      return result
    })
    vi.stubGlobal('navigator', { locks: { request } })
    let release!: () => void
    const second = vi.fn().mockResolvedValue(undefined)
    const first = withWebNotificationDisplayLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const next = withWebNotificationDisplayLock(second)
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    release()
    await Promise.all([first, next])
    expect(second).toHaveBeenCalledOnce()
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'chatbox.client-notification.display',
      'chatbox.client-notification.display',
    ])
    await expect(withWebNotificationDisplayLock(() => Promise.reject(new Error('closed')))).rejects.toThrow('closed')
    await withWebNotificationDisplayLock(second)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('skips Web display when same-origin locking is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const show = vi.fn()
    await withWebNotificationDisplayLock(show)
    expect(show).not.toHaveBeenCalled()
  })

  it('recovers from corrupt data and stores each displayed batch once', () => {
    const batchId = '018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc41'
    window.localStorage.setItem(CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY, '{broken')

    expect(readDisplayedBatchIds()).toEqual([])

    markBatchDisplayed(batchId)
    markBatchDisplayed(batchId)

    expect(JSON.parse(window.localStorage.getItem(CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY) ?? 'null')).toEqual([
      batchId,
    ])
  })
})
