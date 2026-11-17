// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FieldDraftResult, useFieldDraft } from './useFieldDraft'

describe('useFieldDraft', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies a typed draft when the field unmounts', () => {
    const apply = vi.fn((): FieldDraftResult => 'applied')
    const { result, unmount } = renderHook(() => useFieldDraft('1024', apply))
    act(() => result.current.setDraft('4096'))
    expect(apply).not.toHaveBeenCalled()
    unmount()
    expect(apply).toHaveBeenCalledWith('4096')
  })

  it('applies once on flush and not again on unmount', () => {
    const apply = vi.fn((): FieldDraftResult => 'applied')
    const { result, unmount } = renderHook(() => useFieldDraft('a', apply))
    act(() => result.current.setDraft('b'))
    act(() => result.current.flush())
    unmount()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('does nothing on unmount when the field was not edited', () => {
    const apply = vi.fn((): FieldDraftResult => 'applied')
    const { unmount } = renderHook(() => useFieldDraft('a', apply))
    unmount()
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies after the delay without typing', () => {
    vi.useFakeTimers()
    const apply = vi.fn((): FieldDraftResult => 'applied')
    const { result } = renderHook(() => useFieldDraft('a', apply, 600))
    act(() => result.current.setDraft('ab'))
    act(() => vi.advanceTimersByTime(599))
    expect(apply).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(apply).toHaveBeenCalledWith('ab')
  })

  it('shows the committed value again when the draft is rejected', () => {
    const { result } = renderHook(() => useFieldDraft<string>('20', (): FieldDraftResult => 'rejected'))
    act(() => result.current.setDraft('abc'))
    act(() => result.current.flush())
    expect(result.current.draft).toBe('20')
  })

  it('follows the committed value while not being edited', () => {
    const { result, rerender } = renderHook(({ value }) => useFieldDraft(value, (): FieldDraftResult => 'applied'), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    expect(result.current.draft).toBe('b')
    act(() => result.current.setDraft('typed'))
    rerender({ value: 'c' })
    expect(result.current.draft).toBe('typed')
  })

  it('keeps the typed text while editing when a delayed apply stores a normalized value', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useFieldDraft(value, (): FieldDraftResult => 'applied', 600),
      {
        initialProps: { value: 'hello' },
      }
    )
    act(() => result.current.setDraft('hello '))
    act(() => vi.advanceTimersByTime(600))
    rerender({ value: 'hello' })
    expect(result.current.draft).toBe('hello ')
    act(() => result.current.flush())
    rerender({ value: 'hello world' })
    expect(result.current.draft).toBe('hello world')
  })

  it('shows the stored value on blur when a delayed apply rejected the draft', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useFieldDraft('Weekly report', (next): FieldDraftResult => (next.trim() === '' ? 'rejected' : 'applied'), 600)
    )
    act(() => result.current.setDraft(''))
    act(() => vi.advanceTimersByTime(600))
    expect(result.current.draft).toBe('')
    act(() => result.current.flush())
    expect(result.current.draft).toBe('Weekly report')
  })

  it('shows the stored value when an entered value normalizes to it', () => {
    const { result } = renderHook(() =>
      useFieldDraft('1', (next): FieldDraftResult => (Number(next) === 1 ? 'unchanged' : 'applied'))
    )
    act(() => result.current.setDraft('1.0'))
    act(() => result.current.flush())
    expect(result.current.draft).toBe('1')
  })

  it('shows a value stored during editing once editing ends', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useFieldDraft(value, (): FieldDraftResult => 'applied', 600),
      { initialProps: { value: 'Weekly' } }
    )
    act(() => result.current.setDraft(' Weekly report '))
    act(() => vi.advanceTimersByTime(600))
    rerender({ value: 'Weekly report' })
    expect(result.current.draft).toBe(' Weekly report ')
    act(() => result.current.flush())
    expect(result.current.draft).toBe('Weekly report')
  })

  it('keeps a value applied on blur until the stored value updates', () => {
    const { result, rerender } = renderHook(({ value }) => useFieldDraft(value, (): FieldDraftResult => 'applied'), {
      initialProps: { value: '0.7' },
    })
    act(() => result.current.setDraft('0.3'))
    act(() => result.current.flush())
    expect(result.current.draft).toBe('0.3')
    rerender({ value: '0.3' })
    expect(result.current.draft).toBe('0.3')
  })
})
