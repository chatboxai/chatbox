// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
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
})
