import { describe, expect, test } from 'vitest'
import { createSendFollowIntent } from './send-follow-intent'

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
