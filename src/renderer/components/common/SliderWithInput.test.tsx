// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SliderWithInput from './SliderWithInput'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

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

/** Saves like the conversation settings panel: the new value arrives some time after onChange. */
function AsyncSavedSlider({ saveDelay, startUnset = false }: { saveDelay: number; startUnset?: boolean }) {
  const [value, setValue] = useState<number | undefined>(startUnset ? undefined : 0.5)
  return (
    <SliderWithInput
      value={value}
      min={0}
      max={1}
      step={0.1}
      inputTestId="value-input"
      onChange={(next) => setTimeout(() => setValue(next), saveDelay)}
    />
  )
}

describe('SliderWithInput', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the new value while an asynchronous save is still running', () => {
    render(
      <MantineProvider>
        <AsyncSavedSlider saveDelay={300} />
      </MantineProvider>
    )
    const thumb = screen.getByRole('slider')
    const input = screen.getByTestId('value-input') as HTMLInputElement

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.6')

    act(() => vi.advanceTimersByTime(150))
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.6')
    expect(input.value).toBe('0.6')

    act(() => vi.advanceTimersByTime(300))
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.6')
    expect(input.value).toBe('0.6')
  })

  it('keeps the input editable after releasing the thumb on the saved value', () => {
    render(
      <MantineProvider>
        <AsyncSavedSlider saveDelay={300} />
      </MantineProvider>
    )
    const thumb = screen.getByRole('slider')
    const input = screen.getByTestId('value-input') as HTMLInputElement

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' })
    act(() => vi.advanceTimersByTime(500))
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.5')

    fireEvent.change(input, { target: { value: '0.8' } })
    expect(input.value).toBe('0.8')
  })

  it('keeps the first value set from the model default while it saves', () => {
    render(
      <MantineProvider>
        <AsyncSavedSlider saveDelay={300} startUnset />
      </MantineProvider>
    )
    const thumb = screen.getByRole('slider')
    const input = screen.getByTestId('value-input') as HTMLInputElement

    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    act(() => vi.advanceTimersByTime(150))
    expect(thumb.getAttribute('aria-valuenow')).toBe('0.1')
    expect(input.value).toBe('0.1')
  })
})
