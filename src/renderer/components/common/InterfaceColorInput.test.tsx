// @vitest-environment jsdom

import type { ColorInputProps } from '@mantine/core'
import { describe, expect, it, vi } from 'vitest'
import { InterfaceColorInput } from '@/components/common/InterfaceColorInput'
import { fireEvent, render, screen } from '@/test-utils'

vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>()

  return {
    ...actual,
    ColorInput: ({ label, value, maxLength, onChange, onChangeEnd, onBlur }: ColorInputProps) => (
      <div>
        <input
          aria-label={typeof label === 'string' ? label : undefined}
          value={typeof value === 'string' ? value : ''}
          maxLength={maxLength}
          onChange={(event) => {
            const inputValue = event.currentTarget.value
            onChange?.(inputValue)
            if (/^#[0-9a-f]{3}$/i.test(inputValue)) {
              const [, r, g, b] = inputValue
              onChangeEnd?.(`#${r}${r}${g}${g}${b}${b}`)
            }
          }}
          onBlur={onBlur}
        />
        <button type="button" onClick={() => onChangeEnd?.(typeof value === 'string' ? value : '')}>
          Finish picking
        </button>
      </div>
    ),
  }
})

describe('InterfaceColorInput', () => {
  it('previews color changes locally and commits only when picking ends', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#ffffff" onCommit={onChange} />)

    fireEvent.change(screen.getByLabelText('Primary Background'), { target: { value: '#123456' } })

    expect((screen.getByLabelText('Primary Background') as HTMLInputElement).value).toBe('#123456')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Finish picking' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('#123456')
  })

  it('commits a typed color when the input loses focus', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#ffffff" onCommit={onChange} />)

    const input = screen.getByLabelText('Primary Background')
    fireEvent.change(input, { target: { value: '#ABCDEF' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  it('keeps a partially deleted three-digit color instead of expanding it', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#ffffff" onCommit={onChange} />)

    fireEvent.change(screen.getByLabelText('Primary Background'), { target: { value: '#fff' } })

    expect((screen.getByLabelText('Primary Background') as HTMLInputElement).value).toBe('#fff')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the hash prefix and limits input to six hexadecimal digits', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#ffffff" onCommit={onChange} />)

    const input = screen.getByLabelText('Primary Background')
    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('#')

    fireEvent.change(input, { target: { value: '12g34h567' } })
    expect((input as HTMLInputElement).value).toBe('#123456')
    expect((input as HTMLInputElement).maxLength).toBe(7)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores the previous color when the completed value is not allowed', () => {
    const onChange = vi.fn()

    render(
      <InterfaceColorInput
        label="Brand Color"
        value="#228be6"
        isColorAllowed={(color) => color !== '#ffffff'}
        onCommit={onChange}
      />
    )

    const input = screen.getByLabelText('Brand Color')
    fireEvent.change(input, { target: { value: '#FFFFFF' } })
    fireEvent.blur(input)

    expect((input as HTMLInputElement).value).toBe('#228be6')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still allows white when no color restriction is provided', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#000000" onCommit={onChange} />)

    const input = screen.getByLabelText('Primary Background')
    fireEvent.change(input, { target: { value: '#ffffff' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('#ffffff')
  })

  it('reports complete, allowed drafts before they commit', () => {
    const onCommit = vi.fn()
    const onDraftChange = vi.fn()

    render(
      <InterfaceColorInput
        label="Brand Color"
        value="#228be6"
        isColorAllowed={(color) => color !== '#ffffff'}
        onCommit={onCommit}
        onDraftChange={onDraftChange}
      />
    )

    const input = screen.getByLabelText('Brand Color')
    fireEvent.change(input, { target: { value: '#12A150' } })
    expect(onDraftChange).toHaveBeenLastCalledWith('#12a150')
    expect(onCommit).not.toHaveBeenCalled()

    onDraftChange.mockClear()
    fireEvent.change(input, { target: { value: '#12a1' } })
    fireEvent.change(input, { target: { value: '#ffffff' } })
    expect(onDraftChange).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onDraftChange).toHaveBeenLastCalledWith('#228be6')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not commit the same color again when blur follows picking end', () => {
    const onChange = vi.fn()

    render(<InterfaceColorInput label="Primary Background" value="#ffffff" onCommit={onChange} />)

    const input = screen.getByLabelText('Primary Background')
    fireEvent.change(input, { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish picking' }))
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledOnce()
  })
})
