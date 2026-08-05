// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { Message } from '@shared/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import QueuedMessageEditor from './QueuedMessageEditor'

const t = vi.fn((key?: string, values?: Record<string, string>) =>
  (key ?? '').replace(/{{(\w+)}}/g, (_, name: string) => values?.[name] ?? `{{${name}}}`)
)

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})

const message: Message = {
  id: 'message-1',
  role: 'user',
  contentParts: [
    { type: 'text', text: 'before' },
    { type: 'image', storageKey: 'picture:1' },
  ],
  files: [{ id: 'file:1', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file:1' }],
  links: [{ id: 'link:1', url: 'https://example.com', title: 'Example', storageKey: 'link:1' }],
}

function renderEditor({ dispatching = false } = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <MantineProvider>
      <QueuedMessageEditor opened message={message} dispatching={dispatching} onSave={onSave} onClose={onClose} />
    </MantineProvider>
  )
  return { onSave, onClose }
}

describe('QueuedMessageEditor', () => {
  beforeEach(() => t.mockClear())

  test('saves edited text after removing a file', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderEditor()

    await user.clear(screen.getByLabelText('Message'))
    await user.type(screen.getByLabelText('Message'), 'after')
    await user.click(screen.getByRole('button', { name: 'Remove file notes.txt' }))
    await user.click(screen.getByRole('button', { name: 'Save queued message' }))

    expect(t).toHaveBeenCalledWith('Remove file {{name}}', { name: 'notes.txt' })

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [],
        contentParts: expect.arrayContaining([{ type: 'text', text: 'after' }]),
      })
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('removes a link by its storage key', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Remove link Example' }))
    await user.click(screen.getByRole('button', { name: 'Save queued message' }))

    expect(t).toHaveBeenCalledWith('Remove link {{name}}', { name: 'Example' })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ links: [] }))
  })

  test('removes an image content part by storage key', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Remove image' }))
    await user.click(screen.getByRole('button', { name: 'Save queued message' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ contentParts: [{ type: 'text', text: 'before' }] }))
  })

  test('cancels without saving the draft', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderEditor()

    await user.clear(screen.getByLabelText('Message'))
    await user.type(screen.getByLabelText('Message'), 'changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('prevents any mutation while dispatching', () => {
    renderEditor({ dispatching: true })

    expect(screen.getByLabelText('Message')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Remove file notes.txt' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Remove link Example' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Remove image' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save queued message' })).toHaveProperty('disabled', true)
  })
})
