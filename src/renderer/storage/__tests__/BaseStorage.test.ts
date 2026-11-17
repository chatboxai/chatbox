import { beforeEach, describe, expect, it, vi } from 'vitest'
import BaseStorage from '../BaseStorage'

const { getStoreValue, setStoreValue } = vi.hoisted(() => ({
  getStoreValue: vi.fn<(key: string) => Promise<unknown>>(),
  setStoreValue: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}))

vi.mock('@/platform', () => ({ default: { getStoreValue, setStoreValue } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

beforeEach(() => {
  getStoreValue.mockReset().mockResolvedValue(undefined)
  setStoreValue.mockReset().mockResolvedValue(undefined)
})

describe('BaseStorage raw reads', () => {
  it.each([undefined, null])('returns null for %s without initializing storage', async (stored) => {
    getStoreValue.mockResolvedValue(stored)
    setStoreValue.mockRejectedValue(new Error('writes unavailable'))
    const storage = new BaseStorage()

    await expect(storage.getItemRaw('agent-memories')).resolves.toBeNull()
    await expect(storage.getItemRaw('agent-memories')).resolves.toBeNull()
    expect(setStoreValue).not.toHaveBeenCalled()
  })

  it.each([{ stored: false }, { stored: 0 }, { stored: '' }, { stored: [] }, { stored: {} }])(
    'preserves the stored value $stored',
    async ({ stored }) => {
      getStoreValue.mockResolvedValue(stored)

      await expect(new BaseStorage().getItemRaw('existing-key')).resolves.toBe(stored)
      expect(setStoreValue).not.toHaveBeenCalled()
    }
  )

  it('propagates storage read failures', async () => {
    const failure = new Error('read unavailable')
    getStoreValue.mockRejectedValue(failure)

    await expect(new BaseStorage().getItemRaw('agent-memories')).rejects.toBe(failure)
  })
})

describe('BaseStorage initial values', () => {
  it('returns a default while its best-effort seed is still pending', async () => {
    let finishWrite!: () => void
    setStoreValue.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    const initialValue = ['default']

    await expect(new BaseStorage().getItem('fresh-key', initialValue)).resolves.toBe(initialValue)
    finishWrite()
  })

  it('settles a durable first read only after its initial value is persisted', async () => {
    let finishWrite!: () => void
    setStoreValue.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    let settled = false
    const initialValue = ['default']
    const read = new BaseStorage().getItem('fresh-key', initialValue, { persistInitialValue: true }).then((value) => {
      settled = true
      return value
    })
    await vi.waitFor(() => expect(setStoreValue).toHaveBeenCalledWith('fresh-key', initialValue))
    expect(settled).toBe(false)
    finishWrite()
    await expect(read).resolves.toBe(initialValue)
  })

  it('returns a default when its best-effort seed fails', async () => {
    setStoreValue.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(new BaseStorage().getItem('fresh-key', [])).resolves.toEqual([])
  })

  it('reports a durable initial-value write failure to the caller', async () => {
    const failure = new Error('storage unavailable')
    setStoreValue.mockRejectedValueOnce(failure)

    await expect(new BaseStorage().getItem('fresh-key', [], { persistInitialValue: true })).rejects.toBe(failure)
  })

  it('reads an existing value without writing the supplied default', async () => {
    getStoreValue.mockResolvedValueOnce(['stored'])

    await expect(new BaseStorage().getItem('existing-key', ['default'])).resolves.toEqual(['stored'])
    expect(setStoreValue).not.toHaveBeenCalled()
  })
})
