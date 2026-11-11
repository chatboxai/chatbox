// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { settings, setSettings } = vi.hoisted(() => ({
  settings: { language: 'en', autoCompaction: true, compactionRetainRatio: undefined as number | undefined },
  setSettings: vi.fn(),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ ...settings, setSettings }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (config: unknown) => config }))

import { RouteComponent } from './context'

function renderPage() {
  return render(
    <MantineProvider>
      <RouteComponent />
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  settings.autoCompaction = true
  settings.compactionRetainRatio = undefined
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
})
afterEach(cleanup)

describe('recent history budget setting', () => {
  it('defaults to 0% and saves keyboard changes as a ratio', () => {
    renderPage()
    const slider = screen.getByRole('slider', { name: 'Recent History Budget' })
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(setSettings).toHaveBeenCalledWith({ compactionRetainRatio: 0.01 })
  })

  it.each([0, 0.16])('renders a saved ratio of %s without replacing it with the default', (ratio) => {
    settings.compactionRetainRatio = ratio
    renderPage()
    expect(screen.getByRole('slider', { name: 'Recent History Budget' }).getAttribute('aria-valuenow')).toBe(
      String(ratio)
    )
  })

  it('keeps the budget editable for manual compaction when auto compaction is off', () => {
    settings.autoCompaction = false
    renderPage()
    const slider = screen.getByRole('slider', { name: 'Recent History Budget' })
    expect(slider.hasAttribute('data-disabled')).toBe(false)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(setSettings).toHaveBeenCalledWith({ compactionRetainRatio: 0.01 })
  })
})
