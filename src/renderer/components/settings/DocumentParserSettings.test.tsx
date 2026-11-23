// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { state, navigate } = vi.hoisted(() => ({
  state: {
    extension: { documentParser: { type: 'deepseek' as string } },
    providers: { deepseek: { apiKey: 'ds-key' } } as Record<string, { apiKey?: string }>,
    setSettings: () => undefined,
  },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

vi.mock('@/components/AdaptiveSelect', () => ({ AdaptiveSelect: () => null }))

vi.mock('@/platform', () => ({ default: { type: 'desktop', isDesktopLike: true, openLink: vi.fn() } }))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state),
  getPlatformDefaultDocumentParser: () => ({ type: 'local' }),
}))

import { DocumentParserSettings } from './DocumentParserSettings'

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
  state.extension.documentParser.type = 'deepseek'
  state.providers = { deepseek: { apiKey: 'ds-key' } }
  navigate.mockReset()
})
afterEach(cleanup)

async function renderSettings() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <DocumentParserSettings />
      </MantineProvider>
    </I18nextProvider>
  )
}

it('reads the DeepSeek model provider key instead of editing one when DeepSeek parses documents', async () => {
  await renderSettings()

  expect(screen.getByText(/billed by DeepSeek per page/)).toBeTruthy()
  expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'DeepSeek provider settings' }))
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/provider/$providerId', params: { providerId: 'deepseek' } })
})

it('asks for the provider key when DeepSeek parses documents without one', async () => {
  state.providers = {}
  await renderSettings()

  expect(screen.getByText(/Add your DeepSeek API key in the DeepSeek model provider settings/)).toBeTruthy()
})

it('shows the DeepSeek key only for the DeepSeek parser', async () => {
  state.extension.documentParser.type = 'local'
  await renderSettings()

  expect(screen.queryByRole('button', { name: 'DeepSeek provider settings' })).toBeNull()
})
