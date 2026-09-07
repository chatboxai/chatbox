import { describe, expect, test, vi } from 'vitest'
import { CurrentAttachmentAdapter } from './CurrentAttachmentAdapter'

describe('CurrentAttachmentAdapter', () => {
  test('reads attachment content from the injected blob storage', async () => {
    const get = vi.fn(() => Promise.resolve('attachment content'))
    const adapter = new CurrentAttachmentAdapter({ get })

    await expect(adapter.read('file:one')).resolves.toBe('attachment content')
    expect(get).toHaveBeenCalledWith('file:one')
  })

  test('preserves the existing null fallback on read failure', async () => {
    const adapter = new CurrentAttachmentAdapter({
      get: () => Promise.reject(new Error('read failed')),
    })

    await expect(adapter.read('file:one')).resolves.toBeNull()
  })
})
