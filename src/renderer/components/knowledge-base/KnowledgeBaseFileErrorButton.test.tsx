// @vitest-environment jsdom

import { createRef } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test-utils'

const { mockShow } = vi.hoisted(() => ({
  mockShow: vi.fn(),
}))

vi.mock('@ebay/nice-modal-react', () => ({
  default: { show: mockShow },
}))

import { KnowledgeBaseFileErrorButton } from './KnowledgeBaseFileErrorButton'

describe('KnowledgeBaseFileErrorButton', () => {
  test('opens the file processing error modal from a semantic button', () => {
    const buttonRef = createRef<HTMLButtonElement>()
    const onFocus = vi.fn()
    render(
      <KnowledgeBaseFileErrorButton
        errorCode="chatbox_ai_parser_license_key_required"
        fileName="lecture.pdf"
        label="Sign in needed"
        onFocus={onFocus}
        ref={buttonRef}
      >
        Sign in needed
      </KnowledgeBaseFileErrorButton>
    )

    const button = screen.getByRole('button', { name: 'Sign in needed' })
    expect(button.getAttribute('type')).toBe('button')
    expect(buttonRef.current).toBe(button)
    fireEvent.focus(button)
    expect(onFocus).toHaveBeenCalledOnce()

    fireEvent.click(button)
    expect(mockShow).toHaveBeenCalledWith('file-parse-error', {
      errorCode: 'chatbox_ai_parser_license_key_required',
      fileName: 'lecture.pdf',
    })
  })
})
