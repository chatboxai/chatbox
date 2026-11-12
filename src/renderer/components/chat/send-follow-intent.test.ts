import { describe, expect, test } from 'vitest'
import { createSendFollowIntent, sendFromHistoryFollowsTail } from './send-follow-intent'

describe('send follow intent', () => {
  test('follows a send made at the tail until the user leaves it', () => {
    const intent = createSendFollowIntent()
    const stillFollowing = intent.capture(true)
    expect(stillFollowing?.()).toBe(true)
    intent.leaveTail()
    expect(stillFollowing?.()).toBe(false)
  })

  test('ignores a send made while reading history', () => {
    expect(createSendFollowIntent().capture(false)).toBeNull()
  })

  test('treats a pending tail request as following', () => {
    const intent = createSendFollowIntent()
    intent.requestTail()
    expect(intent.capture(false)?.()).toBe(true)
  })

  test('forgets a tail request once the user browses away again', () => {
    const intent = createSendFollowIntent()
    intent.requestTail()
    intent.leaveTail()
    expect(intent.capture(false)).toBeNull()
    intent.requestTail()
    expect(intent.capture(false)?.()).toBe(true)
  })
})

describe('send from history', () => {
  test('returns to the tail in the Capacitor app', () => {
    expect(sendFromHistoryFollowsTail({ platformType: 'mobile', isSmallScreen: true })).toBe(true)
    expect(sendFromHistoryFollowsTail({ platformType: 'mobile', isSmallScreen: false })).toBe(true)
  })

  test('returns to the tail on a small screen outside the app', () => {
    expect(sendFromHistoryFollowsTail({ platformType: 'web', isSmallScreen: true })).toBe(true)
    expect(sendFromHistoryFollowsTail({ platformType: 'desktop', isSmallScreen: true })).toBe(true)
  })

  test('keeps the reading position on wide desktop and web layouts', () => {
    expect(sendFromHistoryFollowsTail({ platformType: 'desktop', isSmallScreen: false })).toBe(false)
    expect(sendFromHistoryFollowsTail({ platformType: 'web', isSmallScreen: false })).toBe(false)
  })
})
