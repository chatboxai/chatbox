// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSmallScreen: false,
  navigateToSettings: vi.fn(),
}))

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { tool?: string }) => (values?.tool ? key.replace('{{tool}}', values.tool) : key),
  }),
}))

vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => mocks.isSmallScreen }))
vi.mock('@/modals/settings-navigation', () => ({ navigateToSettings: mocks.navigateToSettings }))
vi.mock('@/components/common/ChatboxAIErrorMessage', () => ({
  ChatboxAIErrorMessage: ({ errorCode }: { errorCode: number }) => <span>Known error {errorCode}</span>,
}))

import { ToolUnavailableCard } from './ToolUnavailableCard'

describe('ToolUnavailableCard', () => {
  beforeEach(() => {
    mocks.isSmallScreen = false
    mocks.navigateToSettings.mockReset()
  })

  it('guides a signed-out user to Chatbox AI or Web Search settings', async () => {
    render(
      <MantineProvider>
        <ToolUnavailableCard toolLabel="Web Search" toolName="web_search" errorCode={20024} />
      </MantineProvider>
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Web Search was not run: sign in to use Chatbox AI Search')).toBeTruthy()
    expect(screen.getByText(/does not require an API key/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Chatbox AI' }))
    await waitFor(() => expect(mocks.navigateToSettings).toHaveBeenNthCalledWith(1))
    fireEvent.click(screen.getByRole('button', { name: 'Web Search settings' }))
    await waitFor(() => expect(mocks.navigateToSettings).toHaveBeenNthCalledWith(2, '/web-search'))
  })

  it('uses the known localized error detail for other Chatbox AI tool failures', () => {
    render(
      <MantineProvider>
        <ToolUnavailableCard toolLabel="Web Search" toolName="web_search" errorCode={20025} />
      </MantineProvider>
    )

    expect(screen.getByText('Web Search could not run')).toBeTruthy()
    expect(screen.getByText('Known error 20025')).toBeTruthy()
  })

  it('stacks full-width actions on small screens', () => {
    mocks.isSmallScreen = true
    render(
      <MantineProvider>
        <ToolUnavailableCard toolLabel="Web Search" toolName="web_search" errorCode={20024} />
      </MantineProvider>
    )

    expect(screen.getByRole('button', { name: 'Sign in to Chatbox AI' }).getAttribute('data-block')).toBe('true')
    expect(screen.getByRole('button', { name: 'Web Search settings' }).getAttribute('data-block')).toBe('true')
  })
})
