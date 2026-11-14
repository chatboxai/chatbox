// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { state, navigate } = vi.hoisted(() => ({
  state: { providers: {} as Record<string, { apiKey?: string }> },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state),
}))

import { DeepSeekProviderKeyRow } from './DeepSeekProviderKeyRow'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

beforeEach(() => {
  state.providers = {}
  navigate.mockReset()
})
afterEach(cleanup)

async function renderRow() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <DeepSeekProviderKeyRow />
      </MantineProvider>
    </I18nextProvider>
  )
}

it('has no key field and points to the DeepSeek provider settings when the key is missing', async () => {
  await renderRow()

  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull()
  expect(screen.getByText(/Add your DeepSeek API key in the DeepSeek model provider settings/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'DeepSeek provider settings' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/provider/$providerId', params: { providerId: 'deepseek' } })
})

it('reads the key from the DeepSeek provider and still links to it', async () => {
  state.providers = { deepseek: { apiKey: 'ds-key' } }
  await renderRow()

  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText(/Uses the API key configured for the DeepSeek model provider/)).toBeTruthy()
  expect(screen.queryByText(/Add your DeepSeek API key/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'DeepSeek provider settings' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/provider/$providerId', params: { providerId: 'deepseek' } })
})

it('treats a blank provider key as missing', async () => {
  state.providers = { deepseek: { apiKey: '   ' } }
  await renderRow()

  expect(screen.getByText(/Add your DeepSeek API key/)).toBeTruthy()
})
