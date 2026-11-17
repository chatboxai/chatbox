import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { BackgroundStreamBridge } from '@shared/utils/background-stream'

export const backgroundStreamBridge = registerPlugin<BackgroundStreamBridge>('BackgroundStream')
export const backgroundStreamPrototypeEnabled = import.meta.env.VITE_BACKGROUND_STREAM_PROTOTYPE === '1'

export function subscribeBackgroundStreamResume(resume: () => void): () => void {
  let disposed = false
  const subscription = App.addListener('appStateChange', ({ isActive }) => {
    if (!disposed && isActive) resume()
  })
  void subscription.catch(() => {})
  return () => {
    disposed = true
    void subscription.then((handle) => handle.remove()).catch(() => {})
  }
}

if (backgroundStreamPrototypeEnabled) {
  const target = globalThis as typeof globalThis & { __chatboxBackgroundStreamQA?: BackgroundStreamBridge }
  target.__chatboxBackgroundStreamQA = backgroundStreamBridge
}
