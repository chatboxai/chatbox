import { type RefObject, useLayoutEffect } from 'react'

export function blurActiveElementWithin(target?: HTMLElement | null) {
  if (typeof document === 'undefined') {
    return
  }

  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) {
    return
  }

  if (target && !target.contains(activeElement)) {
    return
  }

  activeElement.blur()
}

export function handoffFocusToOverlay(target?: HTMLElement | null) {
  if (typeof document === 'undefined') {
    return
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement) {
    if (target?.contains(activeElement)) {
      return
    }

    blurActiveElementWithin()
  }

  if (target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true })
  }
}

export function useBlurActiveElementOnOpen(opened: boolean) {
  useLayoutEffect(() => {
    if (!opened) {
      return
    }

    handoffFocusToOverlay()
  }, [opened])
}

export function useOverlayFocusHandoff(opened: boolean, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!opened) {
      return
    }

    handoffFocusToOverlay(ref.current)
  }, [opened, ref])
}
