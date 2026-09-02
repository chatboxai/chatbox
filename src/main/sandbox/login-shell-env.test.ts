import { describe, expect, it, vi } from 'vitest'

vi.mock('../util', () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../mcp/shell-env', () => ({
  shellEnv: vi.fn(async () => ({ PATH: '/opt/homebrew/bin:/usr/bin' })),
}))

import { shellEnv } from '../mcp/shell-env'
import { getLoginShellPath, getLoginShellPathIfReady, mergePathEntries } from './login-shell-env'

describe('mergePathEntries', () => {
  it('keeps inherited entries first and appends missing login shell entries', () => {
    expect(mergePathEntries('/usr/sbin:/sbin', '/opt/homebrew/bin:/usr/bin')).toBe(
      '/usr/sbin:/sbin:/opt/homebrew/bin:/usr/bin'
    )
  })

  it('preserves inherited precedence for entries present in both paths', () => {
    expect(mergePathEntries('/my-env/bin:/usr/bin:/bin', '/usr/bin:/bin:/opt/homebrew/bin')).toBe(
      '/my-env/bin:/usr/bin:/bin:/opt/homebrew/bin'
    )
  })

  it('keeps the inherited PATH when the login shell PATH is missing', () => {
    expect(mergePathEntries('/usr/bin:/bin', undefined)).toBe('/usr/bin:/bin')
  })

  it('keeps the login shell PATH when the inherited PATH is missing', () => {
    expect(mergePathEntries(undefined, '/opt/homebrew/bin')).toBe('/opt/homebrew/bin')
  })

  it('drops empty segments and returns undefined when nothing remains', () => {
    expect(mergePathEntries('::', '')).toBeUndefined()
    expect(mergePathEntries(undefined, undefined)).toBeUndefined()
  })
})

describe('getLoginShellPath', () => {
  it.runIf(process.platform !== 'win32')('forks the login shell only once and caches the result', async () => {
    const first = await getLoginShellPath()
    const second = await getLoginShellPath()
    expect(first).toContain('/opt/homebrew/bin')
    expect(second).toBe(first)
    expect(vi.mocked(shellEnv)).toHaveBeenCalledTimes(1)
  })

  it.runIf(process.platform === 'win32')('resolves undefined on Windows without forking a shell', async () => {
    expect(await getLoginShellPath()).toBeUndefined()
    expect(vi.mocked(shellEnv)).not.toHaveBeenCalled()
  })

  it.runIf(process.platform !== 'win32')('getLoginShellPathIfReady returns the value once settled', async () => {
    const value = await getLoginShellPath()
    expect(getLoginShellPathIfReady()).toBe(value)
  })

  it.runIf(process.platform !== 'win32')('getLoginShellPathIfReady returns undefined while pending', async () => {
    vi.resetModules()
    vi.doMock('../mcp/shell-env', () => ({
      shellEnv: vi.fn(() => new Promise(() => {})),
    }))
    try {
      const fresh = await import('./login-shell-env')
      expect(fresh.getLoginShellPathIfReady()).toBeUndefined()
    } finally {
      vi.doUnmock('../mcp/shell-env')
    }
  })

  it.runIf(process.platform !== 'win32')('resolves undefined when the login shell probe times out', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    try {
      vi.doMock('../mcp/shell-env', () => ({
        // A shell whose profile blocks forever (e.g. reading a FIFO-backed env file)
        shellEnv: vi.fn(() => new Promise(() => {})),
      }))
      const fresh = await import('./login-shell-env')
      const promise = fresh.getLoginShellPath()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(promise).resolves.toBeUndefined()
    } finally {
      vi.doUnmock('../mcp/shell-env')
      vi.useRealTimers()
    }
  })
})
