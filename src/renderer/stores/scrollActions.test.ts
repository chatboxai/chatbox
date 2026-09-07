// @vitest-environment jsdom

import type { Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptNavigation } from './uiStore'

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  state: {
    messageListElement: null as { current: HTMLDivElement | null } | null,
    transcriptNavigation: null as TranscriptNavigation | null,
  },
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { requireCompleteSessionView: mocks.complete } },
}))
vi.mock('./sessionHelpers', () => ({ getAllMessageList: (session: Session) => session.messages }))
vi.mock('./uiStore', () => ({ uiStore: { getState: () => mocks.state } }))

import { scrollToMessage } from './scrollActions'

function mount(sessionId = 's', view: TranscriptNavigation['view'] = 'complete') {
  const container = document.createElement('div')
  container.dataset.sessionId = sessionId
  container.dataset.sessionView = view
  container.getBoundingClientRect = () => new DOMRect(0, 0, 300, 500)
  const list = document.createElement('div')
  list.dataset.testid = 'virtuoso-item-list'
  container.append(list)
  document.body.append(container)
  const scrollToIndex = vi.fn(() => true)
  mocks.state.messageListElement = { current: container }
  mocks.state.transcriptNavigation = { owner: Symbol(sessionId), sessionId, view, scrollToIndex }
  return { container, list, scrollToIndex }
}

function addMessage(parent: HTMLElement, id: string, top = 100) {
  const message = document.createElement('div')
  message.id = id
  message.getBoundingClientRect = () => new DOMRect(0, top, 300, 100)
  parent.append(message)
  return message
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => clearTimeout(frame))
  mocks.state.messageListElement = null
  mocks.state.transcriptNavigation = null
  mocks.complete.mockReset().mockResolvedValue({
    id: 's',
    type: 'chat',
    name: 'Chat',
    messages: [
      { id: 'm0', role: 'user', contentParts: [{ type: 'text', text: 'Old message' }] },
      { id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text: 'Reply' }] },
    ],
  } satisfies Session)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('scrollToMessage transcript ownership', () => {
  it('does not accept a visible target when its owner rejects the command', async () => {
    const view = mount()
    addMessage(view.list, 'm0')
    view.scrollToIndex.mockReturnValue(false)
    expect(await scrollToMessage('s', 'm0')).toBe(false)
  })

  it('rejects a replaced complete capability even when its container is unchanged', async () => {
    const view = mount()
    addMessage(view.list, 'm0')
    let finish: ((session: Session) => void) | undefined
    const session = await mocks.complete()
    mocks.complete.mockImplementationOnce(
      () =>
        new Promise<Session>((resolve) => {
          finish = resolve
        })
    )
    const result = scrollToMessage('s', 'm0')
    const replacement = vi.fn(() => true)
    mocks.state.transcriptNavigation = {
      owner: Symbol('s'),
      sessionId: 's',
      view: 'complete',
      scrollToIndex: replacement,
    }
    finish?.(session)
    expect(await result).toBe(false)
    expect(view.scrollToIndex).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()
  })

  it('rejects an owner change after movement even when the same target remains visible', async () => {
    const view = mount()
    addMessage(view.list, 'm0')
    view.scrollToIndex.mockImplementationOnce(() => {
      mocks.state.transcriptNavigation = {
        owner: Symbol('s'),
        sessionId: 's',
        view: 'complete',
        scrollToIndex: vi.fn(() => true),
      }
      return true
    })
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(32)
    expect(await result).toBe(false)
  })

  it('expires when animation frames are suspended and ignores a frame delivered after expiry', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 7
    })
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const view = mount('s', 'window')
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe(false)
    expect(cancel).toHaveBeenCalledWith(7)
    expect(vi.getTimerCount()).toBe(0)

    view.container.dataset.sessionView = 'complete'
    addMessage(view.list, 'm0')
    pendingFrame?.(performance.now())
    await Promise.resolve()
    expect(view.scrollToIndex).not.toHaveBeenCalled()
  })

  it('rejects an expired frame even when it resumes before the deadline timer', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 7
    })
    const view = mount('s', 'window')
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1)
    const now = vi.spyOn(performance, 'now').mockReturnValue(2000)
    view.container.dataset.sessionView = 'complete'
    addMessage(view.list, 'm0')
    pendingFrame?.(2000)
    expect(await result).toBe(false)
    expect(view.scrollToIndex).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    now.mockRestore()
  })

  it('does not send complete-session indices to the old window or accept a duplicate search preview', async () => {
    const { scrollToIndex } = mount('s', 'window')
    addMessage(document.body, 'm0')
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(false)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('waits for the complete Virtuoso initial positioning before locating an off-window message', async () => {
    const view = mount('s', 'window')
    const owner = mocks.state.transcriptNavigation?.owner
    if (!owner) throw new Error('Missing window navigation owner')
    addMessage(document.body, 'm0')
    const completeScroll = vi.fn(() => {
      addMessage(view.list, 'm0')
      return true
    })
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(48)
    view.container.dataset.sessionView = 'complete'
    view.list.style.visibility = 'hidden'
    mocks.state.transcriptNavigation = { owner, sessionId: 's', view: 'complete', scrollToIndex: completeScroll }
    await vi.advanceTimersByTimeAsync(80)
    expect(completeScroll).not.toHaveBeenCalled()
    view.list.style.visibility = 'visible'
    await vi.advanceTimersByTimeAsync(48)
    expect(await result).toBe(true)
    expect(view.scrollToIndex).not.toHaveBeenCalled()
    expect(completeScroll).toHaveBeenCalledWith({ index: 0, align: 'start', behavior: 'auto' })
  })

  it('rejects a window-to-complete transition belonging to a new session mount in the same container', async () => {
    const view = mount('s', 'window')
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(32)
    view.container.dataset.sessionView = 'complete'
    addMessage(view.list, 'm0')
    const replacement = vi.fn(() => true)
    mocks.state.transcriptNavigation = {
      owner: Symbol('s'),
      sessionId: 's',
      view: 'complete',
      scrollToIndex: replacement,
    }
    await vi.advanceTimersByTimeAsync(32)
    expect(await result).toBe(false)
    expect(replacement).not.toHaveBeenCalled()
  })

  it('returns false until the main transcript target is inside its viewport', async () => {
    const view = mount()
    addMessage(document.body, 'm0')
    addMessage(view.list, 'm0', 700)
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toBe(false)
    expect(view.scrollToIndex).toHaveBeenCalledTimes(1)
  })

  it('rejects a different session and an A-to-B-to-A replacement while the complete read is pending', async () => {
    const other = mount('other')
    const wrongSession = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(1100)
    expect(await wrongSession).toBe(false)
    expect(other.scrollToIndex).not.toHaveBeenCalled()

    const original = mount()
    let finish: ((session: Session) => void) | undefined
    const session = await mocks.complete()
    mocks.complete.mockImplementationOnce(
      () =>
        new Promise<Session>((resolve) => {
          finish = resolve
        })
    )
    const switched = scrollToMessage('s', 'm0')
    mount('other')
    const replacement = mount()
    addMessage(replacement.list, 'm0')
    finish?.(session)
    await vi.advanceTimersByTimeAsync(32)
    expect(await switched).toBe(false)
    expect(original.scrollToIndex).not.toHaveBeenCalled()
    expect(replacement.scrollToIndex).not.toHaveBeenCalled()
  })

  it('does not report success when the target is absent or the view is replaced after the scroll command', async () => {
    const view = mount()
    expect(await scrollToMessage('s', 'missing')).toBe(false)
    expect(view.scrollToIndex).not.toHaveBeenCalled()
    view.scrollToIndex.mockImplementationOnce(() => {
      mount('other')
      return true
    })
    const result = scrollToMessage('s', 'm0')
    await vi.advanceTimersByTimeAsync(32)
    expect(await result).toBe(false)
  })
})
