import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLongPressController, createScrollInertiaTracker } from './message-long-press'

describe('createLongPressController', () => {
  let clock = 0
  beforeEach(() => {
    vi.useFakeTimers()
    clock = 1_000
  })
  afterEach(() => vi.useRealTimers())

  const tracker = () => createScrollInertiaTracker({ now: () => clock })
  const create = (inertia = tracker()) => {
    const onLongPress = vi.fn()
    const controller = createLongPressController({ onLongPress, inertia })
    return { controller, onLongPress, inertia }
  }

  it('fires once after 500ms and marks the release as consumed', () => {
    const { controller, onLongPress } = create()
    expect(controller.start({ x: 10, y: 20 })).toBe(true)
    vi.advanceTimersByTime(499)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(controller.end()).toBe(true)
    controller.start({ x: 10, y: 20 })
    expect(controller.end()).toBe(false)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('treats a short press as a tap', () => {
    const { controller, onLongPress } = create()
    controller.start({ x: 0, y: 0 })
    vi.advanceTimersByTime(300)
    expect(controller.end()).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('tolerates small movement and cancels once the finger travels more than 10px', () => {
    const { controller, onLongPress } = create()
    controller.start({ x: 0, y: 0 })
    controller.move({ x: 10, y: -10 })
    expect(controller.isPressing()).toBe(true)
    controller.move({ x: 0, y: 11 })
    expect(controller.isPressing()).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('keeps the press while the app scrolls on its own, such as following a streaming reply', () => {
    const { controller, onLongPress, inertia } = create()
    inertia.scroll()
    inertia.touchStart({ x: 0, y: 0 })
    expect(controller.start({ x: 0, y: 0 })).toBe(true)
    inertia.scroll()
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('does not start a timer on another message when the press only stops a fling', () => {
    const inertia = tracker()
    const a = create(inertia)
    const b = create(inertia)

    // The user flings starting on message A.
    inertia.touchStart({ x: 0, y: 400 })
    a.controller.start({ x: 0, y: 400 })
    inertia.touchMove({ x: 0, y: 300 })
    a.controller.move({ x: 0, y: 300 })
    inertia.scroll()
    a.controller.end()
    clock += 60
    inertia.scroll()

    // The list is still coasting when the finger lands on message B.
    clock += 50
    inertia.touchStart({ x: 0, y: 200 })
    expect(b.controller.start({ x: 0, y: 200 })).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(b.onLongPress).not.toHaveBeenCalled()

    // Once the list rests, the next press on B opens its menu.
    clock += 200
    inertia.touchStart({ x: 0, y: 200 })
    expect(b.controller.start({ x: 0, y: 200 })).toBe(true)
    vi.advanceTimersByTime(500)
    expect(b.onLongPress).toHaveBeenCalledTimes(1)
  })

  it('treats a scroll without a preceding drag as resting', () => {
    const inertia = tracker()
    const { controller } = create(inertia)
    inertia.touchStart({ x: 0, y: 0 })
    inertia.scroll()
    clock += 10
    inertia.touchStart({ x: 0, y: 0 })
    expect(controller.start({ x: 0, y: 0 })).toBe(true)
  })

  it('ends the user scroll once the list rests, so a later app scroll is not inertia', () => {
    const inertia = tracker()
    const b = create(inertia)
    inertia.touchStart({ x: 0, y: 400 })
    inertia.touchMove({ x: 0, y: 300 })
    inertia.scroll()
    clock += 5_000
    // A streaming reply moves the transcript long after the fling settled.
    inertia.scroll()
    clock += 10
    inertia.touchStart({ x: 0, y: 200 })
    expect(b.controller.start({ x: 0, y: 200 })).toBe(true)
    vi.advanceTimersByTime(500)
    expect(b.onLongPress).toHaveBeenCalledTimes(1)
  })
})
