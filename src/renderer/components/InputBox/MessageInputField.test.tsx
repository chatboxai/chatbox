// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { type ComponentProps, createRef, type Ref } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import type { MessageInputFieldRef } from './MessageInputField'

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

vi.mock('@/hooks/useMessageInput', async () => {
  const { useCallback, useState } = await import('react')
  return {
    useMessageInput: () => {
      const [messageInput, setMessageInput] = useState('')
      const clearDraft = useCallback(() => setMessageInput(''), [])
      return { messageInput, setMessageInput, clearDraft }
    },
  }
})

import { MessageInputField } from './MessageInputField'

const defaultProps = {
  isNewSession: false,
  viewportHeight: 800,
  isReadOnly: false,
  placeholder: 'Waiting for approval',
  ariaLabel: 'Type your question here...',
  autoFocus: false,
  onValueChange: vi.fn(),
  onKeyDown: vi.fn(),
  onPaste: vi.fn(),
}

function renderField(props: Partial<ComponentProps<typeof MessageInputField>> = {}, ref?: Ref<MessageInputFieldRef>) {
  return render(
    <MantineProvider>
      <MessageInputField {...defaultProps} {...props} ref={ref} />
    </MantineProvider>
  )
}

function textareaValue(input: HTMLElement): string {
  return (input as HTMLTextAreaElement).value
}

describe('MessageInputField', () => {
  test('exposes a localized accessible name independently from its placeholder', () => {
    renderField({ isReadOnly: true })

    const input = screen.getByRole('textbox', { name: 'Type your question here...' })
    expect(input.getAttribute('placeholder')).toBe('Waiting for approval')
    expect(input).toHaveProperty('readOnly', true)
  })

  test('keeps typed text in the textarea', async () => {
    const onValueChange = vi.fn()
    const onUserInput = vi.fn()
    renderField({ onValueChange, onUserInput })

    const input = screen.getByRole('textbox', { name: 'Type your question here...' })
    fireEvent.input(input, { target: { value: 'hello' } })

    await waitFor(() => expect(textareaValue(input)).toBe('hello'))
    expect(onValueChange).toHaveBeenCalledWith('hello')
    expect(onUserInput).toHaveBeenCalledTimes(1)
  })

  test('keeps composing IME text visible and accepts ordinary input after commit', async () => {
    const onValueChange = vi.fn()
    const onUserInput = vi.fn()
    const ref = createRef<MessageInputFieldRef>()
    renderField({ onValueChange, onUserInput }, ref)

    act(() => ref.current?.setValue('prefix '))
    const input = screen.getByRole('textbox', { name: 'Type your question here...' })
    await waitFor(() => expect(textareaValue(input)).toBe('prefix '))
    onValueChange.mockClear()
    onUserInput.mockClear()

    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: 'prefix n' }, isComposing: true })
    expect(textareaValue(input)).toBe('prefix n')

    fireEvent.input(input, { target: { value: 'prefix ni' }, isComposing: true })
    expect(textareaValue(input)).toBe('prefix ni')
    expect(onValueChange).not.toHaveBeenCalled()
    expect(onUserInput).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input, { target: { value: 'prefix 你' } })
    await waitFor(() => expect(textareaValue(input)).toBe('prefix 你'))
    expect(onValueChange).toHaveBeenCalledWith('prefix 你')
    expect(onUserInput).toHaveBeenCalledTimes(1)

    fireEvent.input(input, { target: { value: 'prefix 你x' } })
    await waitFor(() => expect(textareaValue(input)).toBe('prefix 你x'))
    expect(onValueChange).toHaveBeenCalledWith('prefix 你x')
    expect(onUserInput).toHaveBeenCalledTimes(2)
  })

  test.each(['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'Tab'])('leaves %s to the IME while composing', (key) => {
    const onKeyDown = vi.fn()
    const onValueChange = vi.fn()
    renderField({ onKeyDown, onValueChange })
    const input = screen.getByRole('textbox')
    fireEvent.input(input, { target: { value: 'prefix ' } })
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: 'prefix ni' }, isComposing: true })
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    fireEvent(input, event)
    expect(event.defaultPrevented).toBe(false)
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalledWith('prefix ni')
    fireEvent.input(input, { target: { value: 'prefix ' }, isComposing: true })
    fireEvent.compositionEnd(input, { data: '' })
    expect(textareaValue(input)).toBe('prefix ')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  test.each([{ isComposing: true }, { keyCode: 229 }])('honors native IME key metadata %j', (metadata) => {
    const onKeyDown = vi.fn()
    renderField({ onKeyDown })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', ...metadata })
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  test('does not persist composing nine-key digits as the committed value', () => {
    const onValueChange = vi.fn()
    renderField({ onValueChange })

    const input = screen.getByRole('textbox', { name: 'Type your question here...' })
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: '4456872579665' }, isComposing: true })

    expect(textareaValue(input)).toBe('4456872579665')
    expect(onValueChange).not.toHaveBeenCalledWith('4456872579665')
  })

  test.each([
    { initial: 'prefix ', start: 7, end: 7, composing: 'prefix 4456872579665', expected: 'prefix hello' },
    { initial: 'abcXYZdef', start: 3, end: 6, composing: 'abc4456872579665def', expected: 'abchellodef' },
  ])(
    'pasting during composition replaces the range $start-$end in "$initial"',
    async ({ initial, start, end, composing, expected }) => {
      const onValueChange = vi.fn()
      const onPaste = vi.fn()
      const ref = createRef<MessageInputFieldRef>()
      renderField({ onValueChange, onPaste }, ref)

      act(() => ref.current?.setValue(initial))
      const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Type your question here...' })
      await waitFor(() => expect(textareaValue(input)).toBe(initial))
      onValueChange.mockClear()

      input.setSelectionRange(start, end)
      fireEvent.compositionStart(input)
      fireEvent.input(input, { target: { value: composing }, isComposing: true })
      expect(textareaValue(input)).toBe(composing)

      fireEvent.paste(input, {
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? 'hello' : ''),
          items: [],
        },
      })

      await waitFor(() => expect(textareaValue(input)).toBe(expected))
      expect(input.selectionStart).toBe(start + 'hello'.length)
      expect(input.selectionEnd).toBe(start + 'hello'.length)
      expect(onValueChange).toHaveBeenCalledWith(expected)
      expect(onValueChange).not.toHaveBeenCalledWith(composing)
      expect(onPaste).toHaveBeenCalled()

      onValueChange.mockClear()
      fireEvent.compositionEnd(input)
      expect(textareaValue(input)).toBe(expected)
      expect(onValueChange).not.toHaveBeenCalled()

      const cursor = input.selectionStart
      const next = `${expected.slice(0, cursor)}!${expected.slice(cursor)}`
      fireEvent.input(input, { target: { value: next } })
      expect(textareaValue(input)).toBe(next)
      expect(onValueChange).toHaveBeenCalledWith(next)
    }
  )
})
