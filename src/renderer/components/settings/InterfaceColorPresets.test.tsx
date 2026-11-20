// @vitest-environment jsdom

import { type ColorInputProps, MantineProvider } from '@mantine/core'
import { getDefaultInterfaceColors, INTERFACE_COLOR_PRESETS, type InterfaceColors } from '@shared/theme-colors'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { produce } from 'immer'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StoreApi, UseBoundStore } from 'zustand'
import zh from '../../../../packages/chatbox-i18n/src/locales/zh-Hans/translation.json'
import { InterfaceColorPresets } from './InterfaceColorPresets'

type TestSettings = {
  interfaceColors?: InterfaceColors
  interfaceColorPresets?: Array<{ id: string; label: string; colors: InterfaceColors }>
}

const settings = vi.hoisted(() => ({ store: undefined as unknown }))
const ui = vi.hoisted(() => ({ store: undefined as unknown }))

vi.mock('@/stores/settingsStore', async () => {
  const { create } = await import('zustand')
  const { produce } = await import('immer')
  type State = TestSettings & { setSettings: (updater: (draft: TestSettings) => void) => void }
  const store = create<State>()((set) => ({
    setSettings: (updater) => set((state) => produce(state, updater)),
  }))
  settings.store = store
  return { useSettingsStore: store }
})

vi.mock('@/stores/uiStore', async () => {
  const { create } = await import('zustand')
  const store = create<{ realTheme: 'light' | 'dark' }>(() => ({ realTheme: 'light' }))
  ui.store = store
  return { useUIStore: store }
})

// Typing reports a draft like dragging the picker does; the color commits on blur.
vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>()
  return {
    ...actual,
    ColorInput: ({ label, value, onChange, onBlur }: ColorInputProps) => (
      <input
        aria-label={typeof label === 'string' ? label : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        onBlur={onBlur}
      />
    ),
  }
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

function settingsStore() {
  return settings.store as UseBoundStore<StoreApi<TestSettings>>
}

function setRealTheme(realTheme: 'light' | 'dark') {
  ;(ui.store as UseBoundStore<StoreApi<{ realTheme: 'light' | 'dark' }>>).setState({ realTheme })
}

const mistBlue = INTERFACE_COLOR_PRESETS[2]
const longName = 'My Very Long Custom Preset Name'
const customColors = produce(getDefaultInterfaceColors(), (draft) => {
  draft.light.brand = '#7c3aed'
})

beforeEach(() => {
  setRealTheme('light')
  settingsStore().setState({
    interfaceColors: getDefaultInterfaceColors(),
    interfaceColorPresets: [{ id: 'mine', label: longName, colors: customColors }],
  })
})

afterEach(cleanup)

async function renderPresets() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'zh-Hans',
    resources: { 'zh-Hans': { translation: zh } },
    interpolation: { escapeValue: false },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <InterfaceColorPresets />
      </MantineProvider>
    </I18nextProvider>
  )
}

function chip(name: string) {
  return screen.getByRole('button', { name })
}

it('always shows every preset name, custom labels verbatim', async () => {
  await renderPresets()
  for (const name of [zh.Default, zh['Claude Classic'], zh['Mist Blue'], longName]) {
    expect(screen.getByText(name)).toBeTruthy()
  }
  expect(chip(zh.Default).getAttribute('aria-pressed')).toBe('true')
  expect(chip(zh['Mist Blue']).getAttribute('aria-pressed')).toBe('false')
})

it('applies a preset when its chip is clicked', async () => {
  await renderPresets()
  fireEvent.click(chip(zh['Mist Blue']))

  expect(settingsStore().getState().interfaceColors).toEqual(mistBlue.colors)
  expect(chip(zh['Mist Blue']).getAttribute('aria-pressed')).toBe('true')
  expect(chip(zh.Default).getAttribute('aria-pressed')).toBe('false')
})

it('locks built-in presets in edit mode and lets custom ones be edited or deleted', async () => {
  await renderPresets()
  fireEvent.click(screen.getByRole('button', { name: zh['Edit custom presets'] }))

  expect(screen.queryByRole('button', { name: zh['Custom…'] })).toBeNull()
  const builtIn = chip(zh['Mist Blue']) as HTMLButtonElement
  expect(builtIn.disabled).toBe(true)
  fireEvent.click(builtIn)
  expect(settingsStore().getState().interfaceColors).toEqual(getDefaultInterfaceColors())

  fireEvent.click(chip(longName))
  expect(settingsStore().getState().interfaceColors).toEqual(customColors)
  expect((screen.getByLabelText(zh.Name) as HTMLInputElement).value).toBe(longName)

  fireEvent.click(screen.getByRole('button', { name: zh.Delete }))
  expect(settingsStore().getState().interfaceColorPresets).toEqual([])
  expect(screen.queryByText(longName)).toBeNull()
  expect(screen.queryByLabelText(zh.Name)).toBeNull()
  expect((chip(zh['Mist Blue']) as HTMLButtonElement).disabled).toBe(false)
})

function openNewPresetForm() {
  fireEvent.click(screen.getByRole('button', { name: zh['Custom…'] }))
  return screen.getByRole('img', { name: zh.Preview })
}

function colorInput(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

it('starts a preset created after deleting the last custom one outside edit mode', async () => {
  await renderPresets()
  fireEvent.click(screen.getByRole('button', { name: zh['Edit custom presets'] }))
  fireEvent.click(screen.getByRole('button', { name: zh.Delete }))

  openNewPresetForm()
  fireEvent.click(screen.getByRole('button', { name: zh['Save Preset'] }))

  expect(settingsStore().getState().interfaceColorPresets).toHaveLength(1)
  expect(screen.getByRole('button', { name: zh['Custom…'] })).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['Edit custom presets'] })).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.Done })).toBeNull()
  expect((chip(zh['Mist Blue']) as HTMLButtonElement).disabled).toBe(false)
})

it('previews picked colors before they commit', async () => {
  await renderPresets()
  const preview = openNewPresetForm()
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')

  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a150' } })
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#12a150')
  expect(settingsStore().getState().interfaceColors?.light.brand).toBe('#228be6')

  fireEvent.blur(colorInput(zh['Brand Color']))
  expect(settingsStore().getState().interfaceColors?.light.brand).toBe('#12a150')
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#12a150')

  fireEvent.change(colorInput(zh['Primary Background']), { target: { value: '#fafafa' } })
  expect(preview.style.getPropertyValue('--preview-bg-1')).toBe('#fafafa')
})

it('keeps the preview on the last valid color for incomplete or disallowed input', async () => {
  await renderPresets()
  const preview = openNewPresetForm()

  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a' } })
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')

  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#ffffff' } })
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')
  fireEvent.blur(colorInput(zh['Brand Color']))
  expect(settingsStore().getState().interfaceColors?.light.brand).toBe('#228be6')
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')
})

it('drops uncommitted preview colors on cancel, reset and preset changes', async () => {
  await renderPresets()
  let preview = openNewPresetForm()
  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a150' } })
  fireEvent.click(screen.getByRole('button', { name: zh.Cancel }))

  preview = openNewPresetForm()
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')

  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a150' } })
  fireEvent.blur(colorInput(zh['Brand Color']))
  fireEvent.change(colorInput(zh['Primary Background']), { target: { value: '#fafafa' } })
  fireEvent.click(screen.getByRole('button', { name: zh['Reset Colors'] }))
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')
  expect(preview.style.getPropertyValue('--preview-bg-1')).toBe('#ffffff')

  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a150' } })
  fireEvent.click(chip(zh['Mist Blue']))
  expect(preview.style.getPropertyValue('--preview-brand')).toBe(mistBlue.colors.light.brand)
})

it('drops uncommitted preview colors when the theme switches', async () => {
  await renderPresets()
  const preview = openNewPresetForm()
  fireEvent.change(colorInput(zh['Brand Color']), { target: { value: '#12a150' } })
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#12a150')

  act(() => setRealTheme('dark'))
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')
  expect(preview.style.getPropertyValue('--preview-bg-1')).toBe('#242424')

  act(() => setRealTheme('light'))
  expect(preview.style.getPropertyValue('--preview-brand')).toBe('#228be6')
  expect(preview.style.getPropertyValue('--preview-bg-1')).toBe('#ffffff')
  expect(colorInput(zh['Brand Color']).value).toBe('#228be6')
})
