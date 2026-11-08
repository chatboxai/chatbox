// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  formatMessageTimestamp,
  getMessageHeader,
  getMessageHeaderTitle,
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

const deepseek = {
  aiProvider: 'deepseek',
  aiProviderName: 'DeepSeek',
  model: 'DeepSeek (DS Chat)',
  modelId: 'deepseek-chat',
}
const on = { fallbackLabel: 'Assistant', showModelName: true, showTime: true }

function renderRow(
  props: Partial<Omit<ComponentProps<typeof MessageNameRow>, 'header'>> & {
    message?: Parameters<typeof getMessageHeader>[0]
    options?: Partial<Parameters<typeof getMessageHeader>[1]>
  } = {}
) {
  const { message = deepseek, options, ...rowProps } = props
  return render(
    <MantineProvider>
      <MessageNameRow
        header={getMessageHeader(message, { ...on, ...options })}
        layout="classic"
        isSmallScreen={false}
        generating={false}
        {...rowProps}
      />
    </MantineProvider>
  )
}

describe('Message header', () => {
  test('names the provider and puts the model id after it', () => {
    expect(getMessageHeader(deepseek, { ...on, showTime: false })).toEqual({
      name: 'DeepSeek',
      meta: { provider: undefined, model: 'deepseek-chat', time: undefined },
      detail: 'deepseek-chat',
    })
  })

  test('names the copilot and puts the provider before the model', () => {
    const header = getMessageHeader({ ...deepseek, timestamp: Date.now() }, { ...on, assistantName: 'Mover' })
    expect(header.name).toBe('Mover')
    expect(header.meta).toMatchObject({ provider: 'DeepSeek', model: 'deepseek-chat' })
    expect(header.detail).toMatch(/^DeepSeek · deepseek-chat · \d{2}:\d{2}$/)
  })

  test('reads replies from before provider names and model ids were recorded', () => {
    expect(getMessageHeader({ model: 'OpenAI (GPT-4o nick)' }, on)).toMatchObject({
      name: 'OpenAI',
      meta: { model: 'GPT-4o nick' },
    })
    expect(getMessageHeader({ model: 'Chatbox AI 4' }, on)).toMatchObject({
      name: 'Chatbox AI 4',
      meta: { model: undefined },
    })
    expect(getMessageHeader({}, on).name).toBe('Assistant')
    expect(
      getMessageHeader({ aiProvider: 'custom-1', modelId: 'm' }, { ...on, lookupProviderName: () => 'Gateway' }).name
    ).toBe('Gateway')
  })

  test('drops only the segments whose settings are off', () => {
    const off = { ...on, showModelName: false, showTime: false }
    expect(getMessageHeader({ ...deepseek, timestamp: Date.now() }, off).meta).toEqual({
      provider: undefined,
      model: undefined,
      time: undefined,
    })
    expect(getMessageHeader(deepseek, { ...off, assistantName: 'Mover' }).meta.provider).toBe('DeepSeek')
  })

  test('hover text puts the name over every detail', () => {
    expect(getMessageHeaderTitle(getMessageHeader(deepseek, { ...on, showModelName: false }))).toBe(
      'DeepSeek\ndeepseek-chat'
    )
    expect(getMessageHeaderTitle(getMessageHeader({}, on))).toBe('Assistant')
  })
})

describe('Session assistant name', () => {
  test('names only chats started from a copilot', () => {
    const copilots = [{ id: 'c1', name: 'Translator' }]
    expect(getSessionAssistantName({}, copilots)).toBeUndefined()
    expect(getSessionAssistantName({ copilotId: 'c1' }, copilots)).toBe('Translator')
  })

  test('prefers the session name over the copilot, and the copilot over the provider', () => {
    const copilots = [{ id: 'c1', name: 'Translator' }]
    const name = (session: { assistantName?: string; copilotId?: string }) =>
      getMessageHeader(deepseek, { ...on, showTime: false, assistantName: getSessionAssistantName(session, copilots) })
    expect(name({ assistantName: ' Mover ', copilotId: 'c1' })).toMatchObject({
      name: 'Mover',
      detail: 'DeepSeek · deepseek-chat',
    })
    expect(name({ assistantName: '  ', copilotId: 'c1' })).toMatchObject({ name: 'Translator' })
    expect(name({})).toMatchObject({ name: 'DeepSeek', detail: 'deepseek-chat' })
  })

  test('never takes the chat title for a copilot without a saved definition', () => {
    // A renamed chat whose copilot was deleted, never saved, or not imported.
    const session = { copilotId: 'missing', name: 'October expenses' }
    expect(getSessionAssistantName(session, [{ id: 'c1', name: 'Translator' }])).toBeUndefined()
    expect(getMessageHeader(deepseek, { ...on, assistantName: getSessionAssistantName(session, []) }).name).toBe(
      'DeepSeek'
    )
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
  test('renders a bold name and grey monospace details on one line', () => {
    renderRow({ message: { ...deepseek, timestamp: Date.now() }, options: { assistantName: 'Mover' } })
    const name = screen.getByText('Mover')
    const row = name.parentElement as HTMLElement
    expect(row.textContent).toMatch(/^MoverDeepSeek · deepseek-chat · \d{2}:\d{2}$/)
    expect(row.getAttribute('title')).toMatch(/^Mover\nDeepSeek · deepseek-chat · \d{2}:\d{2}$/)
    expect(row.className).toContain('whitespace-nowrap')
    expect(row.className).toContain('mb-1')
    expect(name.className).toContain('font-semibold')
    expect(name.className).toContain('max-w-[45%]')
    const meta = screen.getByText('deepseek-chat').parentElement as HTMLElement
    expect(meta.className).toContain('font-mono')
    expect(meta.className).toContain('text-[var(--chatbox-message-name-muted)]')
  })

  test('gives way in the model first, then the provider, and never in the time', () => {
    renderRow({ message: { ...deepseek, timestamp: Date.now() }, options: { assistantName: 'Mover' } })
    expect(screen.getByText('deepseek-chat').className).toContain('shrink-[1000]')
    expect(screen.getByText('DeepSeek').className).toContain('max-w-[10em]')
    expect(screen.getByText(/^\d{2}:\d{2}$/).className).toContain('shrink-0')
  })

  test('shows the bold name alone, across the row, when both details are off', () => {
    renderRow({ options: { showModelName: false, showTime: false }, isSmallScreen: true, layout: 'bubble' })
    const name = screen.getByText('DeepSeek')
    const row = name.parentElement as HTMLElement
    expect(row.textContent).toBe('DeepSeek')
    expect(name.className).not.toContain('max-w-[45%]')
    expect(row.getAttribute('title')).toBeNull()
    expect(row.className).toContain('mb-1.5')
  })

  test('shows the generic assistant label for replies without any provider information', () => {
    renderRow({ message: {} })
    expect(screen.getByText('Assistant')).toBeTruthy()
  })

  test('shifts down by the given offset to center on the avatar', () => {
    renderRow()
    expect((screen.getByText('DeepSeek').parentElement as HTMLElement).style.marginTop).toBe('')
    cleanup()
    renderRow({ offsetTop: 4 })
    expect((screen.getByText('DeepSeek').parentElement as HTMLElement).style.marginTop).toBe('4px')
  })

  test('adds a spinner only when asked to', () => {
    renderRow()
    expect(screen.queryByLabelText('Generating...')).toBeNull()
    cleanup()
    renderRow({ generating: true })
    expect(screen.getByLabelText('Generating...')).toBeTruthy()
  })
})
