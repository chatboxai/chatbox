// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  formatMessageTimestamp,
  getMessageNameRowParts,
  getSessionAssistantName,
  MessageNameRow,
} from './MessageNameRow'

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' '),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

afterEach(cleanup)

function renderRow(props: Partial<ComponentProps<typeof MessageNameRow>> = {}) {
  return render(
    <MantineProvider>
      <MessageNameRow layout="classic" isSmallScreen={false} generating={false} {...props} />
    </MantineProvider>
  )
}

describe('Message name row parts', () => {
  test('shows the model alone for ordinary chats', () => {
    expect(getMessageNameRowParts({ model: 'gpt-5.1', fallbackLabel: 'Assistant' })).toEqual({
      assistantName: undefined,
      label: 'gpt-5.1',
      time: undefined,
      title: 'gpt-5.1',
    })
  })

  test('puts the copilot name before the model', () => {
    expect(
      getMessageNameRowParts({
        assistantName: 'Translator',
        model: 'gpt-5.1',
        time: '14:32',
        fallbackLabel: 'Assistant',
      })
    ).toEqual({ assistantName: 'Translator', label: 'gpt-5.1', time: '14:32', title: 'Translator · gpt-5.1' })
  })

  test('falls back for replies without a model', () => {
    expect(getMessageNameRowParts({ assistantName: 'Translator', fallbackLabel: 'Assistant' })).toMatchObject({
      assistantName: 'Translator',
      label: undefined,
      title: 'Translator',
    })
    expect(getMessageNameRowParts({ model: '  ', fallbackLabel: 'Assistant' })).toMatchObject({
      assistantName: undefined,
      label: 'Assistant',
    })
  })
})

describe('Session assistant name', () => {
  test('names only chats started from a copilot', () => {
    const copilots = [{ id: 'c1', name: 'Translator' }]
    expect(getSessionAssistantName({}, copilots)).toBeUndefined()
    expect(getSessionAssistantName({ copilotId: 'c1' }, copilots)).toBe('Translator')
  })

  test('never takes the chat title for a copilot without a saved definition', () => {
    // A renamed chat whose copilot was deleted, never saved, or not imported.
    const session = { copilotId: 'missing', name: 'October expenses' }
    expect(getSessionAssistantName(session, [{ id: 'c1', name: 'Translator' }])).toBeUndefined()
    expect(
      getMessageNameRowParts({
        assistantName: getSessionAssistantName(session, []),
        model: 'gpt-5.1',
        fallbackLabel: 'Assistant',
      })
    ).toMatchObject({
      assistantName: undefined,
      label: 'gpt-5.1',
    })
  })
})

describe('Message timestamp', () => {
  test('keeps the existing today / this year / older formats', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime()
    expect(formatMessageTimestamp(today)).toBe('09:05')
    expect(formatMessageTimestamp(new Date(2001, 2, 4, 7, 8).getTime())).toBe('2001-03-04 07:08')
  })
})

describe('MessageNameRow', () => {
  test('renders the segments in one line with separators and the full names as hover text', () => {
    renderRow({ assistantName: 'Translator', model: 'gpt-5.1', timestamp: Date.now() })
    const rowElement = screen.getByTitle('Translator · gpt-5.1')
    expect(rowElement.textContent).toMatch(/^Translator·gpt-5\.1·\d{2}:\d{2}$/)
    expect(rowElement.className).toContain('whitespace-nowrap')
    expect(rowElement.className).toContain('mb-1')
    expect(screen.getByText('Translator').className).toContain('max-w-[50%]')
    expect(screen.getByText('Translator').className).toContain('shrink-0')
    expect(screen.getByText('gpt-5.1').className).toContain('min-w-0')
    expect(screen.getByText('Translator').className).toContain('font-semibold')
    expect(screen.getByText('gpt-5.1').className).not.toContain('font-semibold')
  })

  test('bolds the model when it leads the row and uses the touch sizes on small screens', () => {
    renderRow({ model: 'gpt-5.1', isSmallScreen: true, layout: 'bubble' })
    const model = screen.getByText('gpt-5.1')
    expect(model.className).toContain('font-semibold')
    const row = model.parentElement as HTMLElement
    expect(row.getAttribute('title')).toBeNull()
    expect(row.className).toContain('leading-[18px]')
    expect(row.className).toContain('mb-1.5')
  })

  test('shows the generic assistant label for replies that predate model tracking', () => {
    renderRow({})
    expect(screen.getByText('Assistant')).toBeTruthy()
  })

  test('adds a spinner only when asked to', () => {
    renderRow({ model: 'gpt-5.1' })
    expect(screen.queryByLabelText('Generating...')).toBeNull()
    cleanup()
    renderRow({ model: 'gpt-5.1', generating: true })
    expect(screen.getByLabelText('Generating...')).toBeTruthy()
  })
})
