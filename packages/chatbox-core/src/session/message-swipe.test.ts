import { describe, expect, it } from 'vitest'
import { getMessageMenuEntries, type MessageMenuAvailability } from './message-menu'
import {
  getMessageSwipeCuePin,
  getMessageSwipeCuePinProgress,
  getMessageSwipeMode,
  getMessageSwipeOffset,
  getMessageSwipeProgress,
  getMessageSwipeState,
  isMessageSwipeArmed,
  MESSAGE_SWIPE,
  MESSAGE_SWIPE_CUE,
  resolveMessageSwipeAxis,
  resolveMessageSwipeDistance,
} from './message-swipe'

const all: MessageMenuAvailability = {
  stop: true,
  retry: true,
  replyBelow: true,
  edit: true,
  copy: true,
  generateMoreImages: true,
  selectText: true,
  quote: true,
  report: true,
  viewJson: false,
  delete: true,
}

describe('resolveMessageSwipeDistance', () => {
  it('counts the finger travel up to the maximum', () => {
    expect(resolveMessageSwipeDistance(0, true)).toBe(0)
    expect(resolveMessageSwipeDistance(40, true)).toBe(40)
    expect(resolveMessageSwipeDistance(1000, true)).toBe(MESSAGE_SWIPE.maxDistance)
  })

  it('never counts leftward travel', () => {
    expect(resolveMessageSwipeDistance(-30, true)).toBe(0)
    expect(resolveMessageSwipeDistance(Number.NaN, true)).toBe(0)
  })

  it('counts at most 16px while retry is unavailable', () => {
    expect(resolveMessageSwipeDistance(10, false)).toBe(10)
    expect(resolveMessageSwipeDistance(400, false)).toBe(MESSAGE_SWIPE.disabledMaxDistance)
  })
})

describe('getMessageSwipeOffset', () => {
  it('follows a fifth of the finger and stops inside the gutter', () => {
    expect(getMessageSwipeOffset(0)).toBe(0)
    expect(getMessageSwipeOffset(40)).toBe(8)
    expect(getMessageSwipeOffset(MESSAGE_SWIPE.maxDistance)).toBe(MESSAGE_SWIPE.maxOffset)
    expect(getMessageSwipeOffset(resolveMessageSwipeDistance(400, false))).toBeCloseTo(3.2)
  })
})

describe('isMessageSwipeArmed', () => {
  it('arms at the threshold and disarms when dragged back', () => {
    expect(isMessageSwipeArmed(95.9, true)).toBe(false)
    expect(isMessageSwipeArmed(96, true)).toBe(true)
    expect(isMessageSwipeArmed(resolveMessageSwipeDistance(200, true), true)).toBe(true)
    expect(isMessageSwipeArmed(resolveMessageSwipeDistance(50, true), true)).toBe(false)
  })

  it('never arms while retry is unavailable', () => {
    expect(isMessageSwipeArmed(resolveMessageSwipeDistance(400, false), false)).toBe(false)
    expect(isMessageSwipeArmed(100, false)).toBe(false)
  })
})

describe('resolveMessageSwipeAxis', () => {
  it('waits inside the activation distance', () => {
    expect(resolveMessageSwipeAxis(0, 0)).toBe('pending')
    expect(resolveMessageSwipeAxis(11, 3)).toBe('pending')
  })

  it('locks to a rightward horizontal swipe', () => {
    expect(resolveMessageSwipeAxis(12, 0)).toBe('horizontal')
    expect(resolveMessageSwipeAxis(30, 14)).toBe('horizontal')
  })

  it('gives vertical and leftward moves back', () => {
    expect(resolveMessageSwipeAxis(4, 12)).toBe('cancel')
    expect(resolveMessageSwipeAxis(20, 12)).toBe('cancel')
    expect(resolveMessageSwipeAxis(-8, 0)).toBe('cancel')
  })
})

describe('feedback', () => {
  it('turns the icon up to the threshold, only when retry is available', () => {
    expect(getMessageSwipeProgress(0, true)).toBe(0)
    expect(getMessageSwipeProgress(48, true)).toBe(0.5)
    expect(getMessageSwipeProgress(100, true)).toBe(1)
    expect(getMessageSwipeProgress(16, false)).toBe(0)
  })

  it('tells the avatar slot and name row what to show', () => {
    expect(getMessageSwipeState(0, true)).toBe('idle')
    expect(getMessageSwipeState(80, true)).toBe('dragging')
    expect(getMessageSwipeState(96, true)).toBe('armed')
    expect(getMessageSwipeState(0, false)).toBe('idle')
    expect(getMessageSwipeState(10, false)).toBe('unavailable')
  })
})

describe('getMessageSwipeMode', () => {
  it('offers retry on assistant replies whose menu has Reply Again', () => {
    expect(getMessageSwipeMode('assistant', getMessageMenuEntries({ role: 'assistant' }, all))).toBe('retry')
    expect(getMessageSwipeMode('assistant', getMessageMenuEntries({ role: 'assistant', error: 'boom' }, all))).toBe(
      'retry'
    )
    expect(
      getMessageSwipeMode('assistant', getMessageMenuEntries({ role: 'assistant' }, all, { pictureSession: true }))
    ).toBe('retry')
  })

  it('shows the swipe as unavailable while the reply streams or retry is withheld', () => {
    expect(getMessageSwipeMode('assistant', getMessageMenuEntries({ role: 'assistant', generating: true }, all))).toBe(
      'unavailable'
    )
    expect(
      getMessageSwipeMode('assistant', getMessageMenuEntries({ role: 'assistant' }, { ...all, retry: false }))
    ).toBe('unavailable')
  })

  it('has no swipe on user or system messages, or without a menu', () => {
    expect(getMessageSwipeMode('user', getMessageMenuEntries({ role: 'user' }, all))).toBe('none')
    expect(getMessageSwipeMode('system', getMessageMenuEntries({ role: 'system' }, all))).toBe('none')
    expect(getMessageSwipeMode('assistant', [])).toBe('none')
  })
})

describe('getMessageSwipeCuePin', () => {
  it('keeps the cue in place while the reply top is in view', () => {
    expect(getMessageSwipeCuePin(0, 2000)).toBe(0)
    expect(getMessageSwipeCuePin(-300, 2000)).toBe(0)
  })

  it('moves the cue down without a jump as the reply top scrolls away', () => {
    expect(getMessageSwipeCuePin(1, 2000)).toBe(2)
    expect(getMessageSwipeCuePin(MESSAGE_SWIPE_CUE.gap, 2000)).toBe(2 * MESSAGE_SWIPE_CUE.gap)
  })

  it('pins the cue a gap below the visible top', () => {
    expect(getMessageSwipeCuePin(900, 2000)).toBe(900 + MESSAGE_SWIPE_CUE.gap)
  })

  it('never lets the cue and its fade leave the reply', () => {
    const limit = 600 - MESSAGE_SWIPE_CUE.height - MESSAGE_SWIPE_CUE.fade
    expect(getMessageSwipeCuePin(900, 600)).toBe(limit)
    expect(getMessageSwipeCuePin(900, 20)).toBe(0)
  })
})

describe('getMessageSwipeCuePinProgress', () => {
  it('ramps the band in over one cue line', () => {
    expect(getMessageSwipeCuePinProgress(0)).toBe(0)
    expect(getMessageSwipeCuePinProgress(MESSAGE_SWIPE_CUE.height / 2)).toBe(0.5)
    expect(getMessageSwipeCuePinProgress(500)).toBe(1)
  })
})
