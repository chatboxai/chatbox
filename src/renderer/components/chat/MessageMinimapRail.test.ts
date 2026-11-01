// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import MessageMinimapRail, { getMinimapRenderRange, type MessageMinimapAnchor } from './MessageMinimapRail'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
  }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function createAnchors(count: number): MessageMinimapAnchor[] {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `message-${index + 1}`,
    text: `Message ${index + 1}`,
  }))
}

describe('getMinimapRenderRange', () => {
  test('renders only the visible start of a large minimap plus overscan', () => {
    const range = getMinimapRenderRange(1000, 0, 360)

    expect(range).toEqual({ start: 0, end: 38 })
    expect(range.end - range.start).toBeLessThan(50)
  })

  test('keeps a bounded window around the middle of the minimap', () => {
    const range = getMinimapRenderRange(1000, 6000, 360)

    expect(range).toEqual({ start: 492, end: 538 })
    expect(range.end - range.start).toBeLessThan(50)
  })

  test('includes the final anchor when scrolled to the bottom', () => {
    const range = getMinimapRenderRange(1000, 12_000 - 360, 360)

    expect(range).toEqual({ start: 962, end: 1000 })
  })

  test('uses a stable fallback window before layout is measured', () => {
    expect(getMinimapRenderRange(1000, 0, 0)).toEqual({ start: 0, end: 38 })
    expect(getMinimapRenderRange(0, 0, 0)).toEqual({ start: 0, end: 0 })
  })

  test('pages with wheel and keyboard input while rendering only message anchors', () => {
    const onLoadOlder = vi.fn()
    const onLoadNewer = vi.fn()
    const { container } = render(
      createElement(MessageMinimapRail, {
        anchors: createAnchors(3),
        hasOlder: true,
        hasNewer: true,
        onLoadOlder,
        onLoadNewer,
      })
    )
    expect(screen.getAllByRole('button')).toHaveLength(3)
    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto')!
    Object.defineProperties(scroller, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } })
    scroller.scrollTop = 0
    fireEvent.wheel(scroller, { deltaY: -80 })
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    scroller.scrollTop = 200
    fireEvent.wheel(scroller, { deltaY: 80 })
    expect(onLoadNewer).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jump to message 1' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jump to message 3' }), { key: 'ArrowDown' })
    expect(onLoadOlder).toHaveBeenCalledTimes(2)
    expect(onLoadNewer).toHaveBeenCalledTimes(2)
  })
  test('retries failed navigation through wheel and keyboard input', () => {
    const onRetry = vi.fn()
    const onLoadOlder = vi.fn()
    const onEdge = vi.fn()
    const props = {
      anchors: createAnchors(3),
      hasOlder: true,
      error: new Error('read failed'),
      onRetry,
      onLoadOlder,
      onEdge,
    }
    const view = render(createElement(MessageMinimapRail, props))
    expect(screen.getAllByRole('button')).toHaveLength(3)
    const scroller = view.container.querySelector<HTMLElement>('.overflow-y-auto')!
    fireEvent.wheel(scroller, { deltaY: -80 })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jump to message 1' }), { key: 'Home' })
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onLoadOlder).not.toHaveBeenCalled()
    expect(onEdge).not.toHaveBeenCalled()
    view.rerender(createElement(MessageMinimapRail, { ...props, loading: true }))
    fireEvent.wheel(scroller, { deltaY: -80 })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jump to message 1' }), { key: 'ArrowUp' })
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  test('makes an empty failed rail keyboard-retryable until anchors are available', () => {
    const onRetry = vi.fn()
    const props = { anchors: [], error: new Error('read failed'), onRetry }
    const view = render(createElement(MessageMinimapRail, props))
    const scroller = screen.getByRole('group', { name: 'Try Again' })
    expect(scroller.tabIndex).toBe(0)
    scroller.focus()
    expect(document.activeElement).toBe(scroller)
    fireEvent.keyDown(scroller, { key: 'ArrowUp' })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    view.rerender(createElement(MessageMinimapRail, { ...props, loading: true }))
    fireEvent.keyDown(scroller, { key: 'End' })
    expect(onRetry).toHaveBeenCalledTimes(1)
    view.rerender(createElement(MessageMinimapRail, { anchors: createAnchors(3), onRetry }))
    expect(scroller.tabIndex).toBe(-1)
    expect(scroller.hasAttribute('aria-label')).toBe(false)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  test('keeps keyboard edge focus when navigation replaces the loaded window', async () => {
    const onEdge = vi.fn()
    const view = render(createElement(MessageMinimapRail, { anchors: createAnchors(3), hasOlder: true, onEdge }))
    const first = screen.getByRole('button', { name: 'Jump to message 1' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Home' })
    expect(onEdge).toHaveBeenCalledWith('head')
    const older = createAnchors(3).map((anchor) => ({
      ...anchor,
      messageId: `older-${anchor.messageId}`,
      text: 'Earlier',
    }))
    view.rerender(createElement(MessageMinimapRail, { anchors: older, hasNewer: true, onEdge }))
    await waitFor(() => expect(document.activeElement?.getAttribute('title')).toBe('Earlier'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(onEdge).toHaveBeenLastCalledWith('tail')
    view.rerender(createElement(MessageMinimapRail, { anchors: createAnchors(3), onEdge }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Jump to message 3' })))
  })

  test('releases edge focus after the shared body layout completes', async () => {
    const onEdge = vi.fn()
    const view = render(createElement(MessageMinimapRail, { anchors: createAnchors(3), hasOlder: true, onEdge }))
    const first = screen.getByRole('button', { name: 'Jump to message 1' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Home' })
    const older = createAnchors(3).map((anchor) => ({ ...anchor, messageId: `older-${anchor.messageId}` }))
    view.rerender(createElement(MessageMinimapRail, { anchors: older, loading: true, onEdge }))
    view.rerender(createElement(MessageMinimapRail, { anchors: older, loading: false, onEdge }))
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      outside.focus()
      const updated = older.map((anchor) => ({ ...anchor, assistantText: 'Updated reply' }))
      view.rerender(createElement(MessageMinimapRail, { anchors: updated, onEdge }))
      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  test('keeps a focused preview visible as its loaded reply streams', () => {
    const anchors = createAnchors(3)
    const view = render(createElement(MessageMinimapRail, { anchors }))
    fireEvent.focus(screen.getByRole('button', { name: 'Jump to message 1' }))
    const updated = anchors.map((anchor, index) =>
      index === 0 ? { ...anchor, assistantText: 'Streaming reply' } : anchor
    )
    view.rerender(createElement(MessageMinimapRail, { anchors: updated }))
    expect(screen.getByText('Streaming reply')).toBeTruthy()
  })

  test('moves keyboard focus to anchors outside the rendered window', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    render(createElement(MessageMinimapRail, { anchors: createAnchors(100) }))

    const firstButton = screen.getByRole('button', { name: 'Jump to message 1' })
    firstButton.focus()
    expect(screen.getAllByRole('button').filter((button) => button.tabIndex === 0)).toEqual([firstButton])

    fireEvent.keyDown(firstButton, { key: 'End' })

    const lastButton = await screen.findByRole('button', { name: 'Jump to message 100' })
    await waitFor(() => expect(document.activeElement).toBe(lastButton))
    expect(screen.queryByRole('button', { name: 'Jump to message 1' })).toBeNull()
    expect(screen.getAllByRole('button').length).toBeLessThan(50)

    fireEvent.keyDown(lastButton, { key: 'ArrowUp' })
    const previousButton = screen.getByRole('button', { name: 'Jump to message 99' })
    await waitFor(() => expect(document.activeElement).toBe(previousButton))

    fireEvent.keyDown(previousButton, { key: 'Home' })

    const restoredFirstButton = await screen.findByRole('button', { name: 'Jump to message 1' })
    await waitFor(() => expect(document.activeElement).toBe(restoredFirstButton))
    expect(screen.queryByRole('button', { name: 'Jump to message 100' })).toBeNull()
  })
})
