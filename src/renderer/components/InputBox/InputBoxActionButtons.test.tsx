// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import InputBoxActionButtons from './InputBoxActionButtons'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderButtons({ generating = false, sendDisabled = false } = {}) {
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(
    <MantineProvider>
      <InputBoxActionButtons generating={generating} sendDisabled={sendDisabled} onSend={onSend} onStop={onStop} />
    </MantineProvider>
  )
  return { onSend, onStop }
}

describe('InputBoxActionButtons', () => {
  test('keeps Send and Stop independently available while generating', async () => {
    const user = userEvent.setup()
    const { onSend, onStop } = renderButtons({ generating: true })

    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(screen.getByRole('button', { name: 'Stop generating' }))

    expect(onSend).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  test('only shows Send when not generating', () => {
    renderButtons()

    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop generating' })).toBeNull()
  })

  test('keeps Stop enabled when sending is disabled during generation', () => {
    renderButtons({ generating: true, sendDisabled: true })

    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Stop generating' })).toHaveProperty('disabled', false)
  })
})
