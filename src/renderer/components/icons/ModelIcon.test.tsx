// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelIcon } from './ModelIcon'

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

function renderModelIcon(modelId: string) {
  return render(
    <MantineProvider>
      <ModelIcon modelId={modelId} providerId={ModelProviderEnum.ChatboxAI} size={18} />
    </MantineProvider>
  )
}

describe('ModelIcon', () => {
  it.each(['chatboxai-3.5', 'chatboxai-4'])('uses the backgroundless Chatbox AI icon for %s', (modelId) => {
    const { container } = renderModelIcon(modelId)

    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('keeps the provider image fallback for other Chatbox AI model ids without a model brand', () => {
    renderModelIcon('custom-model')

    expect(screen.getByRole('img', { name: 'chatbox-ai image icon' })).not.toBeNull()
  })
})
