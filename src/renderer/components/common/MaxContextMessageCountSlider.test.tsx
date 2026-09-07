// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { expect, test, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@/test-utils'
import MaxContextMessageCountSlider from './MaxContextMessageCountSlider'

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

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const TRIGGER_LABEL = 'Help for Max Message Count in Context'
const TOOLTIP_TEXT =
  'Regulate the volume of historical messages sent to the AI, striking a harmonious balance between depth of comprehension and the efficiency of responses.'

function touchPointerDown(element: Element) {
  const event = createEvent.pointerDown(element)
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  fireEvent(element, event)
}

test('opens and closes the context message count help tooltip on touch click', async () => {
  render(
    <MantineProvider>
      <MaxContextMessageCountSlider value={20} onChange={() => undefined} />
    </MantineProvider>
  )

  const trigger = screen.getByRole('button', { name: TRIGGER_LABEL })
  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })

  expect((await screen.findByRole('tooltip')).textContent).toContain(TOOLTIP_TEXT)

  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })

  await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBeNull())
})
