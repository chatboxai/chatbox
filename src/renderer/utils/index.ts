export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type KeyboardEventWithComposition = {
  nativeEvent?: {
    isComposing?: boolean
  }
  keyCode?: number
}

export function isKeyboardEventComposing(event: KeyboardEventWithComposition): boolean {
  // Some browsers report keyCode 229 while an IME owns the key event.
  return event.nativeEvent?.isComposing === true || event.keyCode === 229
}
