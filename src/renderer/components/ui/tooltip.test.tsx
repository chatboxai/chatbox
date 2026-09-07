// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@/test-utils'
import { AppTooltip } from './tooltip'

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

function touchPointerDown(element: Element, pointerType: 'touch' | 'pen' = 'touch') {
  const event = createEvent.pointerDown(element, { cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  fireEvent(element, event)
  return event
}

test('opens and closes an opted-in tooltip on touch', async () => {
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  const pointerDownEvent = touchPointerDown(trigger)
  expect(pointerDownEvent.defaultPrevented).toBe(true)
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(trigger, { detail: 0 })

  expect((await screen.findByRole('tooltip')).textContent).toContain('Touch help')

  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })

  await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBeNull())
})

test('opens an opted-in tooltip on pen taps', async () => {
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  const pointerDownEvent = touchPointerDown(trigger, 'pen')
  expect(pointerDownEvent.defaultPrevented).toBe(true)
  fireEvent.click(trigger, { detail: 0 })

  expect((await screen.findByRole('tooltip')).textContent).toContain('Touch help')
})

test('does not consume a pointerdown-less click after an aborted touch gesture', async () => {
  const onClick = vi.fn()
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button" onClick={onClick}>
        Help
      </button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  fireEvent.pointerUp(trigger)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(fireEvent.click(trigger, { detail: 0 })).toBe(true)
  expect(onClick).toHaveBeenCalledOnce()
  expect(screen.queryByRole('tooltip')).toBeNull()
})

test('forgets touch-opened state while disabled', async () => {
  const view = render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })
  await screen.findByRole('tooltip')

  view.rerender(
    <AppTooltip label="Touch help" openOnTouch disabled>
      <button type="button">Help</button>
    </AppTooltip>
  )
  view.rerender(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
})

test('keeps touch state independent across multiple tooltips', async () => {
  render(
    <>
      <AppTooltip label="First help" openOnTouch>
        <button type="button">First</button>
      </AppTooltip>
      <AppTooltip label="Second help" openOnTouch>
        <button type="button">Second</button>
      </AppTooltip>
    </>
  )

  touchPointerDown(screen.getByRole('button', { name: 'First' }))
  fireEvent.click(screen.getByRole('button', { name: 'First' }), { detail: 1 })
  expect((await screen.findByRole('tooltip')).textContent).toContain('First help')

  touchPointerDown(screen.getByRole('button', { name: 'Second' }))
  fireEvent.click(screen.getByRole('button', { name: 'Second' }), { detail: 1 })

  await waitFor(() => {
    expect(screen.queryByText('First help')).toBeNull()
    expect(screen.getByRole('tooltip').textContent).toContain('Second help')
  })
})

test('closes a touch-opened tooltip on outside pointer down', async () => {
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })
  await screen.findByRole('tooltip')

  fireEvent.pointerDown(document.body)

  await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBeNull())
})

test('does not open when a touch gesture is cancelled', () => {
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.pointerCancel(trigger)

  expect(trigger.getAttribute('aria-describedby')).toBeNull()
})

test('does not consume a keyboard click after an unfinished touch sequence', () => {
  const onClick = vi.fn()
  render(
    <AppTooltip label="Touch help" openOnTouch>
      <button type="button" onClick={onClick}>
        Help
      </button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(fireEvent.click(trigger, { detail: 0 })).toBe(true)
  expect(onClick).toHaveBeenCalledOnce()
})

test('preserves hover and keyboard interactions when touch opening is enabled', async () => {
  render(
    <AppTooltip label="Accessible help" openOnTouch>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  fireEvent.pointerMove(trigger)
  expect((await screen.findByRole('tooltip')).textContent).toContain('Accessible help')

  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBeNull())

  fireEvent.focus(trigger)
  expect((await screen.findByRole('tooltip')).textContent).toContain('Accessible help')
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(trigger.getAttribute('aria-describedby')).toBeNull())
})

test('leaves touch behavior disabled unless requested', () => {
  const onOpenChange = vi.fn()
  render(
    <AppTooltip label="Desktop help" onOpenChange={onOpenChange}>
      <button type="button">Help</button>
    </AppTooltip>
  )

  const trigger = screen.getByRole('button', { name: 'Help' })
  touchPointerDown(trigger)
  fireEvent.click(trigger, { detail: 1 })

  expect(trigger.getAttribute('aria-describedby')).toBeNull()
  expect(onOpenChange).not.toHaveBeenCalledWith(true)
})
