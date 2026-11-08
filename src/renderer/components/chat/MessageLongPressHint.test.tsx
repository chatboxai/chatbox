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
    uiStore.setState({ messageGestureHintShown: false, messageLongPressHintShownThisLaunch: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('hides after five seconds without recording it as seen, and shows once per launch', () => {
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.getByTestId(TestId.message.longPressHint).textContent).toContain(
      'Swipe an AI reply right to reply again. Long press a message to edit, copy, or select text'
    )
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
    expect(uiStore.getState().messageGestureHintShown).toBe(false)

    cleanup()
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
  })

  it('shows again on the next launch until acknowledged', () => {
    render(<MessageLongPressHint messages={[reply]} />)
    cleanup()
    uiStore.setState({ messageLongPressHintShownThisLaunch: false })

    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.getByTestId(TestId.message.longPressHint)).toBeTruthy()
  })

  it('records it as seen on Got it', () => {
    render(<MessageLongPressHint messages={[reply]} />)
    expect(uiStore.getState().messageGestureHintShown).toBe(false)
    fireEvent.click(screen.getByTestId(TestId.message.longPressHintDismiss))
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
    expect(uiStore.getState().messageGestureHintShown).toBe(true)

    cleanup()
    uiStore.setState({ messageLongPressHintShownThisLaunch: false })
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
  })

  it('shows once to users who acknowledged the long-press-only hint, then stays away after Got it', async () => {
    localStorage.setItem('ui-store', JSON.stringify({ state: { messageLongPressHintShown: true }, version: 0 }))
    await uiStore.persist.rehydrate()
    expect(uiStore.getState().messageGestureHintShown).toBe(false)

    render(<MessageLongPressHint messages={[reply]} />)
    fireEvent.click(screen.getByTestId(TestId.message.longPressHintDismiss))
    const persisted = JSON.parse(localStorage.getItem('ui-store') ?? '{}')
    expect(persisted.state.messageGestureHintShown).toBe(true)
    expect(persisted.state).not.toHaveProperty('messageLongPressHintShown')

    cleanup()
    uiStore.setState({ messageLongPressHintShownThisLaunch: false })
    await uiStore.persist.rehydrate()
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
  })

  it('stays hidden on wide screens', () => {
    screenState.small = false
    render(<MessageLongPressHint messages={[reply]} />)
    expect(screen.queryByTestId(TestId.message.longPressHint)).toBeNull()
    expect(uiStore.getState().messageLongPressHintShownThisLaunch).toBe(false)
  })
})
