import type { VirtuosoHandle } from 'react-virtuoso'
import { describe, expect, it, vi } from 'vitest'
import { scrollToTranscriptItem, transcriptAnchorLayoutSettled } from './transcript-item-scroll'

describe('transcript virtual coordinate reads', () => {
  it.each([
    ['start', 240],
    ['center', 330],
    ['end', 420],
  ] as const)('scrolls to measured %s geometry without starting an index seek', (align, top) => {
    const scrollTo = vi.fn()
    const scrollIntoView: VirtuosoHandle['scrollIntoView'] = (request) => {
      expect(
        request.calculateViewLocation?.({
          itemTop: 240,
          itemBottom: 820,
          viewportTop: 80,
          viewportBottom: 480,
          locationParams: request,
        })
      ).toBeNull()
    }
    scrollToTranscriptItem({ scrollIntoView, scrollTo }, { scrollTop: 80 } as HTMLElement, 30, align)
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top, behavior: 'auto' })
  })
  it.each([
    ['short content', { scrollTop: 0, scrollHeight: 80, clientHeight: 400 }, 16],
    ['loaded tail target', { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }, 180],
    ['content shrink', { scrollTop: 0, scrollHeight: 300, clientHeight: 400 }, -90],
  ] as const)('accepts only the achievable stable position for %s', (_, viewport, correction) => {
    expect(transcriptAnchorLayoutSettled(viewport, correction, true)).toBe(true)
    expect(transcriptAnchorLayoutSettled(viewport, correction, false)).toBe(false)
  })
  it('does not accept a visible target while its correction remains achievable', () => {
    expect(transcriptAnchorLayoutSettled({ scrollTop: 120, scrollHeight: 1000, clientHeight: 400 }, 180, true)).toBe(
      false
    )
  })
  it('does not apply a delayed measurement after the layout is superseded', () => {
    let request!: Parameters<VirtuosoHandle['scrollIntoView']>[0]
    const scrollTo = vi.fn()
    let current = true
    scrollToTranscriptItem(
      {
        scrollTo,
        scrollIntoView: (value) => {
          request = value
        },
      },
      { scrollTop: 20 } as HTMLElement,
      7,
      'start',
      'auto',
      () => current
    )
    current = false
    expect(
      request.calculateViewLocation?.({
        itemTop: 900,
        itemBottom: 1000,
        viewportTop: 20,
        viewportBottom: 420,
        locationParams: request,
      })
    ).toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('waits for a delayed measurement callback and ignores unavailable coordinates', () => {
    let request!: Parameters<VirtuosoHandle['scrollIntoView']>[0]
    const scrollTo = vi.fn()
    const list = {
      scrollTo,
      scrollIntoView: (value: typeof request) => {
        request = value
      },
    }
    scrollToTranscriptItem(list, { scrollTop: 200 } as HTMLElement, 49, 'end')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(
      request.calculateViewLocation?.({
        itemTop: 0,
        itemBottom: Number.NaN,
        viewportTop: 200,
        viewportBottom: 600,
        locationParams: request,
      })
    ).toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
