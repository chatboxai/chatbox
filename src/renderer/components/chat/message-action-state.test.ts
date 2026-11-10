import { describe, expect, test } from 'vitest'
import { getMessageActionVisibilityClass } from './message-action-state'

describe('message action visibility', () => {
  test('always shows actions that are pinned visible', () => {
    expect(getMessageActionVisibilityClass(true)).toBe('visible opacity-100 pointer-events-auto')
  })

  test('reveals other actions only on hover, on every kind of screen', () => {
    expect(getMessageActionVisibilityClass(false)).toBe(
      'invisible opacity-0 pointer-events-none group-hover/message:visible group-hover/message:opacity-100 group-hover/message:pointer-events-auto'
    )
  })
})
