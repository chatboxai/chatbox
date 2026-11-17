import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appSetProxy: vi.fn(),
  browserSetProxy: vi.fn(),
}))

vi.mock('electron', () => ({ session: { defaultSession: { setProxy: mocks.appSetProxy } } }))
vi.mock('./built-in-browser', () => ({ builtInBrowser: { setProxy: mocks.browserSetProxy } }))
vi.mock('./store-node', () => ({ getSettings: () => ({}) }))

import { ensure } from './proxy'

describe('proxy.ensure', () => {
  beforeEach(() => {
    mocks.appSetProxy.mockReset()
    mocks.browserSetProxy.mockReset()
  })

  it('resolves only after the app and the built-in browser use the proxy', async () => {
    let finishApp: () => void = () => {}
    mocks.appSetProxy.mockReturnValue(
      new Promise<void>((resolve) => {
        finishApp = resolve
      })
    )
    mocks.browserSetProxy.mockResolvedValue(undefined)

    let settled = false
    const applying = ensure('socks5://127.0.0.1:6153').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(mocks.appSetProxy).toHaveBeenCalledWith({ proxyRules: 'socks5://127.0.0.1:6153' })
    expect(mocks.browserSetProxy).toHaveBeenCalledWith('socks5://127.0.0.1:6153')
    expect(settled).toBe(false)

    finishApp()
    await applying
    expect(settled).toBe(true)
  })

  it('clears the proxy for an empty value', async () => {
    mocks.appSetProxy.mockResolvedValue(undefined)
    mocks.browserSetProxy.mockResolvedValue(undefined)
    await ensure(undefined)
    expect(mocks.appSetProxy).toHaveBeenCalledWith({})
    expect(mocks.browserSetProxy).toHaveBeenCalledWith(undefined)
  })
})
