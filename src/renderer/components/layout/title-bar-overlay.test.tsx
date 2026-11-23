// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TITLE_BAR_OVERLAY_ROOT_ATTRIBUTE, useTitleBarOverlayRoot } from './title-bar-overlay'

function Overlay({ active }: { active: boolean }) {
  useTitleBarOverlayRoot(active)
  return null
}

const marked = () => document.documentElement.hasAttribute(TITLE_BAR_OVERLAY_ROOT_ATTRIBUTE)

afterEach(cleanup)

describe('title bar overlay root marker', () => {
  test('marks the root only while an active overlay header is mounted', () => {
    const view = render(<Overlay active={false} />)
    expect(marked()).toBe(false)
    view.rerender(<Overlay active />)
    expect(marked()).toBe(true)
    view.rerender(<Overlay active={false} />)
    expect(marked()).toBe(false)
  })

  test('keeps the marker while a replacement header mounts before the previous one unmounts', () => {
    const previous = render(<Overlay active />)
    const next = render(<Overlay active />)
    previous.unmount()
    expect(marked()).toBe(true)
    next.unmount()
    expect(marked()).toBe(false)
  })
})
