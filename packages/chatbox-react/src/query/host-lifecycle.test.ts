import { focusManager, onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, test } from 'vitest'
import { bindReactQueryHostLifecycle, type HostBooleanStateSource } from './host-lifecycle'

class TestBooleanSource implements HostBooleanStateSource {
  private readonly listeners = new Set<(value: boolean) => void>()

  constructor(private value: boolean) {}

  getCurrent(): boolean {
    return this.value
  }

  subscribe(listener: (value: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: boolean): void {
    this.value = value
    for (const listener of this.listeners) listener(value)
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

describe('bindReactQueryHostLifecycle', () => {
  afterEach(() => {
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
  })

  test('projects host state and removes subscriptions on dispose', async () => {
    const focus = new TestBooleanSource(false)
    const online = new TestBooleanSource(false)
    const dispose = bindReactQueryHostLifecycle({ focus, online })
    await Promise.resolve()

    expect(focusManager.isFocused()).toBe(false)
    expect(onlineManager.isOnline()).toBe(false)
    expect(focus.listenerCount).toBe(1)
    expect(online.listenerCount).toBe(1)

    focus.emit(true)
    online.emit(true)
    expect(focusManager.isFocused()).toBe(true)
    expect(onlineManager.isOnline()).toBe(true)

    dispose()
    expect(focus.listenerCount).toBe(0)
    expect(online.listenerCount).toBe(0)
  })

  test('returns focus tracking to automatic document visibility after dispose', async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    let visibilityState: 'visible' | 'hidden' = 'visible'
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      get: () => ({ visibilityState }),
    })
    focusManager.setFocused(undefined)

    try {
      const focus = new TestBooleanSource(false)
      const dispose = bindReactQueryHostLifecycle({ focus })
      await Promise.resolve()

      expect(focusManager.isFocused()).toBe(false)
      dispose()

      visibilityState = 'hidden'
      expect(focusManager.isFocused()).toBe(false)
      visibilityState = 'visible'
      expect(focusManager.isFocused()).toBe(true)
    } finally {
      focusManager.setFocused(undefined)
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument)
      } else {
        Reflect.deleteProperty(globalThis, 'document')
      }
    }
  })
})
