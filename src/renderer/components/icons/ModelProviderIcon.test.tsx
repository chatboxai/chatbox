// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelProviderIcon } from './ModelProviderIcon'

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

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    providers: [{ id: 'custom-provider', name: 'My Gateway', isCustom: true, iconUrl: 'https://example.com/icon.png' }],
  }),
}))

describe('ModelProviderIcon', () => {
  it.each(['llama-3.3-70b-versatile', 'kimi-k2', 'command-r-plus', 'doubao-1.5-pro'])('keeps the custom supplier badge for %s', (modelId) => {
    const { getByTestId } = render(<MantineProvider><ModelProviderIcon modelId={modelId} providerId="custom-provider" /></MantineProvider>)
    expect(getByTestId('model-provider-badge').querySelector('img')?.alt).toBe('My Gateway')
  })

  it('shows the supplier alongside a third-party model brand', () => {
    const { getByTestId } = render(
      <MantineProvider><ModelProviderIcon modelId="gpt-4o" providerId="openrouter" /></MantineProvider>
    )
    expect(getByTestId('model-provider-badge').querySelector('img')?.alt).toBe('openrouter image icon')
  })

  it('does not repeat an official supplier logo', () => {
    const { queryByTestId } = render(
      <MantineProvider><ModelProviderIcon modelId="gpt-4o" providerId={ModelProviderEnum.OpenAI} /></MantineProvider>
    )
    expect(queryByTestId('model-provider-badge')).toBeNull()
  })

  it('preserves custom supplier images for unrecognized models', () => {
    const { getByRole, queryByTestId } = render(
      <MantineProvider><ModelProviderIcon modelId="my-model" providerId="custom-provider" /></MantineProvider>
    )
    expect(getByRole('img', { name: 'My Gateway' }).getAttribute('src')).toBe('https://example.com/icon.png')
    expect(queryByTestId('model-provider-badge')).toBeNull()
  })
})
