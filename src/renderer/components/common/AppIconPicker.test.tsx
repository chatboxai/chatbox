// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test-utils'
import { AppIconPicker } from './AppIconPicker'

const mocks = vi.hoisted(() => ({ getIcon: vi.fn(), setIcon: vi.fn(), canChangeAppIcon: vi.fn() }))
vi.mock('@/platform/app-icon', () => ({ AppIcon: mocks, canChangeAppIcon: mocks.canChangeAppIcon }))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
})

describe('AppIconPicker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.canChangeAppIcon.mockReturnValue(true)
    mocks.getIcon.mockResolvedValue({ supported: true, icon: 'default' })
  })

  it('hides the control on unsupported platforms without calling the native bridge', () => {
    mocks.canChangeAppIcon.mockReturnValue(false)
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    expect(screen.queryByRole('group', { name: 'App icon' })).toBeNull()
    expect(mocks.getIcon).not.toHaveBeenCalled()
  })

  it('hides the picker when iOS reports alternate icons unavailable', async () => {
    mocks.getIcon.mockResolvedValue({ supported: false, icon: 'default' })
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    await waitFor(() => expect(mocks.getIcon).toHaveBeenCalledOnce())
    expect(screen.queryByRole('group', { name: 'App icon' })).toBeNull()
  })

  it('can retry a failed initial system-state read', async () => {
    mocks.getIcon.mockRejectedValueOnce(new Error('Bridge unavailable'))
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Classic' })).toBeTruthy()
    expect(mocks.getIcon).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['FlatGradient', 'Flat gradient'],
    ['Sculpted', 'Sculpted'],
  ])('reads %s from the system when reopened', async (icon, label) => {
    mocks.getIcon.mockResolvedValue({ supported: true, icon })
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    expect((await screen.findByRole('button', { name: label })).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the old selection on native failure and allows retry', async () => {
    mocks.setIcon.mockRejectedValueOnce(new Error('Native failure')).mockResolvedValueOnce(undefined)
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    const gradient = await screen.findByRole('button', { name: 'Flat gradient' })
    fireEvent.click(gradient)
    await screen.findByText('Unable to change the app icon. Please try again.')
    expect(screen.getByRole('button', { name: 'Classic' }).getAttribute('aria-pressed')).toBe('true')
    mocks.getIcon.mockResolvedValue({ supported: true, icon: 'FlatGradient' })
    fireEvent.click(gradient)
    await waitFor(() => expect(gradient.getAttribute('aria-pressed')).toBe('true'))
    expect(mocks.setIcon).toHaveBeenCalledTimes(2)
  })

  it('prevents overlapping native switches', async () => {
    let complete: (() => void) | undefined
    mocks.setIcon.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    render(
      <MantineProvider>
        <AppIconPicker />
      </MantineProvider>
    )
    const gradient = await screen.findByRole('button', { name: 'Flat gradient' })
    fireEvent.click(gradient)
    fireEvent.click(gradient)
    expect(mocks.setIcon).toHaveBeenCalledTimes(1)
    mocks.getIcon.mockResolvedValue({ supported: true, icon: 'FlatGradient' })
    complete?.()
    await waitFor(() => expect(gradient.getAttribute('aria-pressed')).toBe('true'))
  })
})
