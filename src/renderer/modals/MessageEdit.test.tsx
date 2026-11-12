// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import type { Message } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<{ messages: Message[] }>>(),
  locks:
    vi.fn<
      () => Promise<{
        generatingReplyCount: number
        anyReplyGenerating: boolean
        awaitingPauseDecision: boolean
        compactionRunning: boolean
      }>
    >(),
  save: vi.fn<() => Promise<void>>(),
  resend: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { readSessionMessages: mocks.read } },
}))
vi.mock('@/stores/session/action-guard', () => ({ getSessionLockStateNow: mocks.locks }))
vi.mock('@/stores/session/messages', () => ({ modifyMessage: mocks.save }))
vi.mock('@/stores/session/generation', () => ({ saveAndResendMessage: mocks.resend }))
vi.mock('@/utils/session-lock-copy', () => ({ notifySessionLockBlocked: vi.fn() }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/common/Avatar', () => ({
  UserAvatar: () => <span>User</span>,
  AssistantAvatar: () => <span>Assistant</span>,
  SystemAvatar: () => <span>System</span>,
}))
vi.mock('@/components/common/AdaptiveModal', () => {
  const AdaptiveModal = ({ children, opened }: { children: ReactNode; opened: boolean }) =>
    opened ? <div role="dialog">{children}</div> : null
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => <div>{children}</div>
  AdaptiveModal.CloseButton = (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      Close
    </button>
  )
  return { AdaptiveModal }
})

import MessageEdit from './MessageEdit'

const message: Message = { id: 'message', role: 'user', contentParts: [{ type: 'text', text: 'Original draft' }] }
const unlocked = {
  generatingReplyCount: 0,
  anyReplyGenerating: false,
  awaitingPauseDecision: false,
  compactionRunning: false,
}
NiceModal.register('message-edit-pending', MessageEdit)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function showEditor() {
  render(
    <MantineProvider>
      <NiceModal.Provider />
    </MantineProvider>
  )
  await act(async () => {
    void NiceModal.show('message-edit-pending', { sessionId: 'session', msg: message })
  })
  const input = screen.getByRole<HTMLTextAreaElement>('textbox')
  fireEvent.change(input, { target: { value: 'Edited draft' } })
  return input
}

describe('MessageEdit pending submission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.read.mockResolvedValue({ messages: [message] })
    mocks.locks.mockResolvedValue(unlocked)
    mocks.save.mockResolvedValue(undefined)
    mocks.resend.mockResolvedValue(undefined)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      })
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  test('immediately locks the draft and prevents duplicate mouse and keyboard submissions through both prechecks', async () => {
    const read = deferred<{ messages: Message[] }>()
    const locks = deferred<typeof unlocked>()
    mocks.read.mockReturnValue(read.promise)
    mocks.locks.mockReturnValue(locks.promise)
    const input = await showEditor()
    const resend = screen.getByRole<HTMLButtonElement>('button', { name: 'Save & Resend' })
    fireEvent.click(resend)
    fireEvent.click(resend)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true })

    expect(resend.disabled).toBe(true)
    expect(resend.hasAttribute('data-loading')).toBe(true)
    expect(input.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'User' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Save$/ }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close' }).disabled).toBe(true)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.resend).not.toHaveBeenCalled()

    await act(async () => {
      read.resolve({ messages: [message] })
    })
    expect(mocks.locks).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(input.disabled).toBe(true)
    await act(async () => {
      locks.resolve(unlocked)
    })
    expect(mocks.resend).toHaveBeenCalledExactlyOnceWith('session', {
      ...message,
      contentParts: [{ type: 'text', text: 'Edited draft' }],
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('retains the edited draft after a failed read and permits a fresh retry', async () => {
    mocks.read.mockRejectedValueOnce(new Error('storage busy'))
    const input = await showEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save & Resend' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Failed to apply the action. Please try again.'
    )
    expect(input.value).toBe('Edited draft')
    expect(input.disabled).toBe(false)
    expect(mocks.resend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save & Resend' }))
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledTimes(1))
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('keeps the dialog and edit until Save publishes, and recovers from a write failure', async () => {
    const save = deferred<void>()
    mocks.save.mockReturnValueOnce(save.promise)
    const input = await showEditor()
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(input.disabled).toBe(true)
    await act(async () => {
      save.reject(new Error('write failed'))
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(input.value).toBe('Edited draft')
    expect(input.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.locks).not.toHaveBeenCalled()
  })
})
