// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptNavigation } from './uiStore'

const mocks = vi.hoisted(() => ({ state: { transcriptNavigation: null as TranscriptNavigation | null } }))
vi.mock('./uiStore', () => ({ uiStore: { getState: () => mocks.state } }))
import { scrollToMessage } from './scrollActions'

function mount(sessionId = 's') {
  const navigation: TranscriptNavigation = {
    owner: Symbol(sessionId),
    sessionId,
    navigateMessage: vi.fn(async () => true),
    openSearch: vi.fn(async () => true),
    viewThread: vi.fn(async () => true),
    scrollToIndex: vi.fn(() => true),
  }
  mocks.state.transcriptNavigation = navigation
  return navigation
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<boolean>((done) => {
    resolve = () => done(true)
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => clearTimeout(frame))
  mocks.state.transcriptNavigation = null
})
afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scrollToMessage row-window ownership', () => {
  it('returns false when the mounted controller declines navigation', async () => {
    const navigation = mount()
    vi.mocked(navigation.navigateMessage).mockResolvedValue(false)
    expect(await scrollToMessage('s', 'm0')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns false when the mounted owner rejects the target read', async () => {
    const navigation = mount()
    vi.mocked(navigation.navigateMessage).mockRejectedValue(new Error('target missing'))
    expect(await scrollToMessage('s', 'm0')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a replaced owner while its target read is pending', async () => {
    const navigation = mount()
    const pending = deferred()
    vi.mocked(navigation.navigateMessage).mockReturnValue(pending.promise)
    const result = scrollToMessage('s', 'm0')
    const replacement = mount()
    pending.resolve()
    expect(await result).toBe(false)
    expect(replacement.navigateMessage).not.toHaveBeenCalled()
  })

  it('rejects an owner change performed during navigation', async () => {
    const navigation = mount()
    vi.mocked(navigation.navigateMessage).mockImplementation(async () => {
      mount()
      return true
    })
    expect(await scrollToMessage('s', 'm0')).toBe(false)
  })

  it('expires with suspended animation frames and ignores their late delivery', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 7
    })
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe(false)
    expect(cancel).toHaveBeenCalledWith(7)
    expect(vi.getTimerCount()).toBe(0)
    const navigation = mount()
    pendingFrame?.(performance.now())
    expect(navigation.navigateMessage).not.toHaveBeenCalled()
  })

  it('rejects an expired frame even before the deadline timer is dispatched', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 7
    })
    const result = scrollToMessage('s', 'm0')
    vi.spyOn(performance, 'now').mockReturnValue(2000)
    const navigation = mount()
    pendingFrame?.(2000)
    expect(await result).toBe(false)
    expect(navigation.navigateMessage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not treat a duplicate search preview as a mounted transcript', async () => {
    const preview = document.createElement('div')
    preview.id = 'm0'
    document.body.append(preview)
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(false)
  })

  it('waits for the mounted window and its target navigation promise', async () => {
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(48)
    const navigation = mount()
    const pending = deferred()
    vi.mocked(navigation.navigateMessage).mockReturnValue(pending.promise)
    let finished = false
    void result.then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(32)
    expect(navigation.navigateMessage).toHaveBeenCalledWith('m0')
    expect(finished).toBe(false)
    pending.resolve()
    expect(await result).toBe(true)
    expect(navigation.scrollToIndex).not.toHaveBeenCalled()
  })

  it('rejects a target navigation that outlives the explicit deadline', async () => {
    const navigation = mount()
    const pending = deferred()
    vi.mocked(navigation.navigateMessage).mockReturnValue(pending.promise)
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe(false)
    pending.resolve()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an A-to-B-to-A replacement while the target read is pending', async () => {
    const navigation = mount()
    const pending = deferred()
    vi.mocked(navigation.navigateMessage).mockReturnValue(pending.promise)
    const result = scrollToMessage('s', 'm0')
    mount('other')
    const replacement = mount()
    pending.resolve()
    expect(await result).toBe(false)
    expect(replacement.navigateMessage).not.toHaveBeenCalled()
  })

  it('never dispatches a target to a different conversation', async () => {
    const navigation = mount('other')
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(false)
    expect(navigation.navigateMessage).not.toHaveBeenCalled()
  })

  it('rejects synchronous provider failures and an owner that unmounts', async () => {
    const navigation = mount()
    vi.mocked(navigation.navigateMessage).mockImplementationOnce(() => {
      throw new Error('disposed')
    })
    expect(await scrollToMessage('s', 'm0')).toBe(false)
    vi.mocked(navigation.navigateMessage).mockImplementationOnce(async () => {
      mocks.state.transcriptNavigation = null
      return true
    })
    expect(await scrollToMessage('s', 'm0')).toBe(false)
  })
})
