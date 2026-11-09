import { describe, expect, test } from 'vitest'
import { getMessageActionVisibilityClass } from './message-action-state'

describe('message action visibility', () => {
  test('always shows actions that are pinned visible', () => {
    expect(getMessageActionVisibilityClass(true)).toBe('visible opacity-100 pointer-events-auto')
  })

  test('reveals hidden actions on hover and keeps them visible on screens without hover', () => {
    const className = getMessageActionVisibilityClass(false)
    expect(className).toContain('invisible')
    expect(className).toContain('group-hover/message:visible')
    expect(className).toContain('[@media(hover:none)]:visible')
    expect(className).toContain('[@media(hover:none)]:pointer-events-auto')
  })
})
