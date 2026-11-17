// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { type BuiltInBrowserViewRequest, EMPTY_BUILT_IN_BROWSER_STATE } from '@shared/built-in-browser'
import { act, cleanup, render } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { BuiltInBrowserView } from './BuiltInBrowserPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/platform', () => ({ default: { openLink: vi.fn() } }))
vi.mock('@/components/ActionMenu', () => ({ ActionMenu: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/common/IconButton', () => ({
  ICON_SIZE: { inline: 16 },
  IconButton: ({ onClick, disabled, 'aria-label': label }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} />
  ),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle(action: () => void) {
  await act(async () => {
    action()
    await Promise.resolve()
  })
}

describe('native browser snapshot handoff', () => {
  let frames: Map<number, FrameRequestCallback>
  let frameId: number
  const decode = vi.fn<() => Promise<void>>()

  beforeEach(() => {
    frames = new Map()
    frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 600))
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value: () => true })
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
    decode.mockReset()
  })

  afterEach(() => {
    cleanup()
    document.querySelector('[data-native-view-overlay]')?.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function nextFrame() {
    await settle(() => {
      const pending = Array.from(frames.values())
      frames.clear()
      for (const callback of pending) void callback(0)
    })
  }

  function setup() {
    const capture = deferred<string | null>()
    const decoded = deferred<void>()
    const restored = deferred<string | null>()
    decode.mockReturnValue(decoded.promise)
    let delayRestore = false
    const setView = vi.fn((request: BuiltInBrowserViewRequest) => {
      if (request.visible && request.snapshot) return capture.promise
      if (request.visible && delayRestore) return restored.promise
      return Promise.resolve(null)
    })
    const controls = { setView }
    const browser = { tab: () => controls } as unknown as BuiltInBrowser
    const view = render(
      <MantineProvider>
        <BuiltInBrowserView
          builtInBrowser={browser}
          tab={{ ...EMPTY_BUILT_IN_BROWSER_STATE, id: 'tab', url: 'https://example.com/' }}
        />
      </MantineProvider>
    )
    const overlay = document.createElement('div')
    overlay.setAttribute('data-native-view-overlay', '')
    const open = async () => {
      await settle(() => {
        document.body.append(overlay)
      })
      await nextFrame()
    }
    const close = async () => {
      delayRestore = true
      await settle(() => {
        overlay.remove()
      })
      await nextFrame()
    }
    const hides = () => setView.mock.calls.filter(([request]) => !request.visible)
    return { ...view, capture, decoded, restored, setView, open, close, hides }
  }

  it('decodes and paints the replacement before hiding, and retains it until restoration completes', async () => {
    const view = setup()
    await view.open()
    expect(view.setView).toHaveBeenLastCalledWith({
      visible: true,
      bounds: { x: 0, y: 0, width: 400, height: 600 },
      snapshot: true,
    })
    await settle(() => {
      view.capture.resolve('data:image/png;base64,c25hcHNob3Q=')
    })
    expect(view.container.querySelector('img')).not.toBeNull()
    expect(decode).toHaveBeenCalledOnce()
    expect(view.hides()).toHaveLength(0)
    await settle(() => {
      view.decoded.resolve()
    })
    await nextFrame()
    expect(view.hides()).toHaveLength(0)
    await nextFrame()
    expect(view.hides()).toHaveLength(1)
    expect(view.setView).toHaveBeenLastCalledWith({ visible: false, keepViewing: true })
    await view.close()
    expect(view.container.querySelector('img')).not.toBeNull()
    await settle(() => {
      view.restored.resolve(null)
    })
    await nextFrame()
    expect(view.container.querySelector('img')).not.toBeNull()
    await nextFrame()
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('cancels a pending handoff when the overlay closes during decoding', async () => {
    const view = setup()
    await view.open()
    await settle(() => {
      view.capture.resolve('data:image/png;base64,c25hcHNob3Q=')
    })
    await view.close()
    await settle(() => {
      view.decoded.resolve()
    })
    await nextFrame()
    await nextFrame()
    expect(view.hides()).toHaveLength(0)
    await settle(() => {
      view.restored.resolve(null)
    })
    await nextFrame()
    expect(view.container.querySelector('img')).not.toBeNull()
    await nextFrame()
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('cancels the scheduled hide when the overlay closes between paint frames', async () => {
    const view = setup()
    await view.open()
    await settle(() => {
      view.capture.resolve('data:image/png;base64,c25hcHNob3Q=')
    })
    await settle(() => {
      view.decoded.resolve()
    })
    await nextFrame()
    await view.close()
    await nextFrame()
    expect(view.hides()).toHaveLength(0)
    await settle(() => {
      view.restored.resolve(null)
    })
    await nextFrame()
    expect(view.container.querySelector('img')).not.toBeNull()
    await nextFrame()
    expect(view.container.querySelector('img')).toBeNull()
  })
})
