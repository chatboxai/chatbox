// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { uiStore } from '@/stores/uiStore'
import Toasts from './Toasts'

vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: vi.fn() }))

describe('Toasts', () => {
  afterEach(() => {
    uiStore.setState({ toasts: [] })
  })

  test('runs a toast callback and removes the toast', () => {
    const onClick = vi.fn()
    uiStore.setState({
      toasts: [
        {
          id: 'toast-1',
          content: 'Archived',
          action: { label: 'Undo', onClick },
        },
      ],
    })

    render(<Toasts />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onClick).toHaveBeenCalledOnce()
    expect(uiStore.getState().toasts).toEqual([])
  })

  test('keeps a persistent toast open on clickaway and timeout', () => {
    vi.useFakeTimers()
    try {
      uiStore.setState({ toasts: [{ id: 'persistent', content: 'Copying…', duration: null }] })
      render(<Toasts />)
      act(() => {
        vi.advanceTimersByTime(0)
      })

      fireEvent.mouseDown(document.body)
      fireEvent.click(document.body)
      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      expect(uiStore.getState().toasts.map((toast) => toast.id)).toEqual(['persistent'])
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps a persistent toast open on Escape', () => {
    uiStore.setState({ toasts: [{ id: 'persistent', content: 'Copying…', duration: null }] })
    render(<Toasts />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(uiStore.getState().toasts.map((toast) => toast.id)).toEqual(['persistent'])
  })

  test('dismisses a timed toast on clickaway', () => {
    vi.useFakeTimers()
    try {
      uiStore.setState({ toasts: [{ id: 'timed', content: 'Copied', duration: 3000 }] })
      render(<Toasts />)
      act(() => {
        vi.advanceTimersByTime(0)
      })

      fireEvent.mouseDown(document.body)
      fireEvent.click(document.body)

      expect(uiStore.getState().toasts).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('dismisses a timed toast on Escape', () => {
    uiStore.setState({ toasts: [{ id: 'timed', content: 'Copied', duration: 3000 }] })
    render(<Toasts />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(uiStore.getState().toasts).toEqual([])
  })

  test('dismisses a default-duration toast on timeout', () => {
    vi.useFakeTimers()
    try {
      uiStore.setState({ toasts: [{ id: 'default', content: 'Saved' }] })
      render(<Toasts />)

      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(uiStore.getState().toasts).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
