// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { Message } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}))

import { getSelectTextScrollTop, MessageSelectTextPage } from './MessageSelectTextPage'

const msg = {
  id: 'm1',
  role: 'assistant',
  contentParts: [{ type: 'text', text: 'First paragraph.\n\nSecond paragraph.' }],
} as Message

vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}))

afterEach(cleanup)

describe('getSelectTextScrollTop', () => {
  it('brings the pressed point near the top third and clamps to the scroll range', () => {
    expect(getSelectTextScrollTop(0, 3000, 800)).toBe(0)
    expect(getSelectTextScrollTop(0.5, 3000, 900)).toBe(1200)
    expect(getSelectTextScrollTop(1, 3000, 800)).toBe(2200)
    expect(getSelectTextScrollTop(0.5, 500, 800)).toBe(0)
  })
})

describe('MessageSelectTextPage', () => {
  const renderPage = (onClose = vi.fn()) => {
    render(
      <MantineProvider>
        <MessageSelectTextPage msg={msg} sessionId="s1" scrollRatio={0} onClose={onClose} />
      </MantineProvider>
    )
    return onClose
  }

  it('shows the message text with nothing selected', () => {
    renderPage()
    expect(screen.getByTestId(TestId.message.selectTextPage)).toBeTruthy()
    expect(screen.getByTestId(TestId.message.selectTextBody).textContent).toContain('Second paragraph.')
    expect(screen.getByTestId(TestId.message.selectTextBody).className).toContain('select-text')
    // Same message style scope as the transcript, outside of which the modal is rendered.
    expect(screen.getByTestId(TestId.message.selectTextBody).closest('.msg-block.assistant-msg')).not.toBeNull()
    expect(window.getSelection()?.toString() ?? '').toBe('')
  })

  it('selects the whole message on Select all', () => {
    renderPage()
    fireEvent.click(screen.getByTestId(TestId.message.selectTextSelectAll))
    expect(window.getSelection()?.toString()).toContain('First paragraph.')
  })

  it('closes from the close button', () => {
    const onClose = renderPage()
    fireEvent.click(screen.getByTestId(TestId.message.selectTextClose))
    expect(onClose).toHaveBeenCalled()
  })
})
