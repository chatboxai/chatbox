/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatBridgeShell } from './ChatBridgeShell'
import type { ChatBridgeShellState } from './chatbridge'
import { getArtifactShellState } from './chatbridge'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function renderShell(state: ChatBridgeShellState) {
  return render(
    <MantineProvider>
      <ChatBridgeShell
        state={state}
        title="Embedded app shell"
        description="The host owns lifecycle and fallback."
        surfaceTitle="Runtime surface"
        surfaceDescription="The app stays inside the message."
        statusLabel={state}
        fallbackTitle="Fallback"
        fallbackText="The shell keeps recovery in the same place."
        supportPanel={
          state === 'degraded'
            ? {
                eyebrow: 'Trust rail',
                title: 'What still holds',
                description: 'The host kept the trusted state visible.',
                items: [
                  {
                    label: 'Validated state remains visible',
                    description: 'Only trusted state remains in the thread.',
                    tone: 'safe',
                  },
                ],
              }
            : undefined
        }
        primaryAction={{ label: 'Primary' }}
        secondaryAction={{ label: 'Secondary' }}
      >
        <div>Runtime child</div>
      </ChatBridgeShell>
    </MantineProvider>
  )
}

describe('ChatBridgeShell', () => {
  it('renders active runtime content inside the host shell', () => {
    renderShell('active')

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
    expect(screen.getByText('Runtime child')).toBeTruthy()
    expect(screen.getByText('Embedded app shell')).toBeTruthy()
  })

  it('renders the inline fallback state without a summary receipt', () => {
    renderShell('error')

    expect(screen.getByText('Recovery stays in the same place')).toBeTruthy()
    expect(screen.getByText('The shell keeps recovery in the same place.')).toBeTruthy()
    expect(screen.queryByText('Summary receipt')).toBeNull()
  })

  it('renders the completion state without a separate summary artifact', () => {
    renderShell('complete')

    expect(screen.getByText('The app finished inside the host shell')).toBeTruthy()
    expect(screen.getByText(/no separate summary receipt/i)).toBeTruthy()
  })

  it('renders the degraded recovery rail inline with trusted-state details', () => {
    renderShell('degraded')

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('degraded')
    expect(screen.getByText('What still holds')).toBeTruthy()
    expect(screen.getByText('Validated state remains visible')).toBeTruthy()
    expect(screen.queryByText('Recovery stays in the same place')).toBeNull()
  })
})

describe('getArtifactShellState', () => {
  it('prefers loading while generation is still active', () => {
    expect(getArtifactShellState({ generating: true, preview: false, hasRenderableHtml: false })).toBe('loading')
  })

  it('returns ready before preview starts when renderable html exists', () => {
    expect(getArtifactShellState({ generating: false, preview: false, hasRenderableHtml: true })).toBe('ready')
  })

  it('returns active when preview is open', () => {
    expect(getArtifactShellState({ generating: false, preview: true, hasRenderableHtml: true })).toBe('active')
  })

  it('returns error when no renderable html exists', () => {
    expect(getArtifactShellState({ generating: false, preview: false, hasRenderableHtml: false })).toBe('error')
  })

  it('returns error when the bridge handshake fails after preview was requested', () => {
    expect(getArtifactShellState({ generating: false, preview: true, hasRenderableHtml: true, bridgeError: true })).toBe(
      'error'
    )
  })
})
