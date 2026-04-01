/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatBridgeShell } from './ChatBridgeShell'
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

function renderShell(
  state: 'loading' | 'ready' | 'active' | 'complete' | 'error',
  options?: { includeChild?: boolean }
) {
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
        primaryAction={{ label: 'Primary', onClick: vi.fn() }}
        secondaryAction={{ label: 'Secondary', onClick: vi.fn() }}
      >
        {options?.includeChild ? <div>Runtime child</div> : undefined}
      </ChatBridgeShell>
    </MantineProvider>
  )
}

describe('ChatBridgeShell', () => {
  it('renders active runtime content inside the host shell', () => {
    renderShell('active', { includeChild: true })

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
    expect(screen.getByText('Runtime child')).toBeTruthy()
    expect(screen.getByText('Embedded app shell')).toBeTruthy()
  })

  it('renders ready runtime content inside the host shell when a custom surface is supplied', () => {
    renderShell('ready', { includeChild: true })

    expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('ready')
    expect(screen.getByText('Runtime child')).toBeTruthy()
    expect(screen.queryByText('The app is ready to open from this message when the user chooses to continue.')).toBeNull()
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

  it('suppresses the generic completion receipt when custom surface content is supplied', () => {
    renderShell('complete', { includeChild: true })

    expect(screen.getByText('Runtime child')).toBeTruthy()
    expect(screen.queryByText('The app finished inside the host shell')).toBeNull()
  })

  it('renders a calm recovery checkpoint when host-owned recovery details are supplied', () => {
    render(
      <MantineProvider>
        <ChatBridgeShell
          state="error"
          title="Story Builder shell"
          description="The host kept the thread usable."
          surfaceTitle="Story Builder shell"
          surfaceDescription="The host can keep helping from the last checkpoint."
          statusLabel="Needs recovery"
          goalLabel="Last user goal"
          goalText="Keep writing chapter four, then save the draft back to Drive."
          recoveryLabel="Host-owned recovery"
          recoveryText="The runtime did not finish cleanly, but the host still has the draft outline and resume hint."
          recoveryFootnote="The conversation can continue from preserved host-owned context even if the live runtime stays unavailable."
          recoveryTone="calm"
          primaryAction={{ label: 'Resume app', onClick: vi.fn() }}
          secondaryAction={{ label: 'Ask follow-up', onClick: vi.fn() }}
        />
      </MantineProvider>
    )

    expect(screen.getByText('Last user goal')).toBeTruthy()
    expect(screen.getByText('Keep writing chapter four, then save the draft back to Drive.')).toBeTruthy()
    expect(screen.getByText('Host-owned recovery')).toBeTruthy()
    expect(screen.getByText(/draft outline and resume hint/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume app' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask follow-up' })).toBeTruthy()
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
