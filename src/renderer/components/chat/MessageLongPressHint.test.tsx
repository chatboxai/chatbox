// @vitest-environment jsdom
import { TestId } from '@shared/automation/testids'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const screenState = vi.hoisted(() => ({ small: true }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => screenState.small }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { uiStore } from '@/stores/uiStore'
import { MessageLongPressHint, shouldShowMessageLongPressHint } from './MessageLongPressHint'

const reply = { role: 'assistant' as const, generating: false }

describe('shouldShowMessageLongPressHint', () => {
  it('waits for a finished assistant reply on a small screen that has not seen the hint', () => {
    expect(shouldShowMessageLongPressHint({ isSmallScreen: true, alreadyShown: false, messages: [reply] })).toBe(true)
    expect(shouldShowMessageLongPressHint({ isSmallScreen: false, alreadyShown: false, messages: [reply] })).toBe(false)
    expect(shouldShowMessageLongPressHint({ isSmallScreen: true, alreadyShown: true, messages: [reply] })).toBe(false)
    expect(
      shouldShowMessageLongPressHint({
        isSmallScreen: true,
        alreadyShown: false,
        messages: [{ role: 'user' }, { role: 'assistant', generating: true }],
      })
    ).toBe(false)
  })
})

describe('MessageLongPressHint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    screenState.small = true
    uiStore.setState({ messageLongPressHintShown: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows once, records it, and hides after five seconds', () => {
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.getByTestId(TestId.message.longPressHint).textContent).toContain(
      'Long press a message to reply again, edit, copy, or select text'
    )
    expect(uiStore.getState().messageLongPressHintShown).toBe(true)
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()

    cleanup()
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
  })

  it('closes on Got it', () => {
    render(<MessageLongPressHint messages={[reply]} />)
    fireEvent.click(screen.getByTestId(TestId.message.longPressHintDismiss))
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
  })

  it('stays hidden on wide screens', () => {
    screenState.small = false
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
    expect(uiStore.getState().messageLongPressHintShown).toBe(false)
  })
})
