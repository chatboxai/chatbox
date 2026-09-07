// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLogicalEndScrollLeft, getReasoningSummary, ReasoningInlineSummary } from './ReasoningInlineSummary'

describe('reasoning inline summary', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 240 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 80 })
  })

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uses the latest visible line while reasoning is streaming', () => {
    expect(getReasoningSummary('First line\nThe latest streaming line\n', true)).toBe('The latest streaming line')

    render(
      <MantineProvider>
        <ReasoningInlineSummary content={'First line\nThe latest streaming line'} isThinking />
      </MantineProvider>
    )

    const summary = screen.getByText('· The latest streaming line')
    expect(summary.getAttribute('data-follow-end')).not.toBeNull()
    expect(summary.scrollLeft).toBe(160)
  })

  it('uses a negative scroll offset to follow the logical end in RTL', () => {
    expect(getLogicalEndScrollLeft('rtl', 240, 80)).toBe(-160)
  })

  it('resets a completed reasoning block to its first-line summary', () => {
    expect(getReasoningSummary('Stable first line\nA later detail', false)).toBe('Stable first line')

    render(
      <MantineProvider>
        <ReasoningInlineSummary content={'Stable first line\nA later detail'} isThinking={false} />
      </MantineProvider>
    )

    const summary = screen.getByText('· Stable first line')
    expect(summary.getAttribute('data-follow-end')).toBeNull()
    expect(summary.scrollLeft).toBe(0)
  })
})
