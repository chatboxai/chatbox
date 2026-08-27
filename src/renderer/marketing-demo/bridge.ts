import {
  DEMO_MANIFEST,
  DEMO_PLAYER_SOURCE,
  type DemoLang,
  type DemoLayout,
  type DemoParentMessage,
  type DemoSceneId,
  isDemoParentMessage,
} from '@/marketing-demo/protocol'

type DemoCommandHandlers = {
  onSetScene: (scene: DemoSceneId) => void
  onPlay: () => void
  onPause: () => void
  onSetLang: (lang: DemoLang) => void
  onSetLayout: (layout: DemoLayout) => void
}

export function subscribeDemoCommands(handlers: DemoCommandHandlers): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isDemoParentMessage(event.data)) return
    const message: DemoParentMessage = event.data
    switch (message.type) {
      case 'demo:set-scene':
        handlers.onSetScene(message.scene)
        break
      case 'demo:play':
        handlers.onPlay()
        break
      case 'demo:pause':
        handlers.onPause()
        break
      case 'demo:set-lang':
        handlers.onSetLang(message.lang)
        break
      case 'demo:set-layout':
        handlers.onSetLayout(message.layout)
        break
    }
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

export function postDemoReady(scene: DemoSceneId, elapsedMs: number, durationMs: number): void {
  window.parent.postMessage(
    { source: DEMO_PLAYER_SOURCE, type: 'demo:ready', manifest: DEMO_MANIFEST, scene, elapsedMs, durationMs },
    '*'
  )
}

export function postDemoScene(scene: DemoSceneId, durationMs: number): void {
  window.parent.postMessage({ source: DEMO_PLAYER_SOURCE, type: 'demo:scene', scene, elapsedMs: 0, durationMs }, '*')
}

export function postDemoProgress(scene: DemoSceneId, elapsedMs: number, durationMs: number): void {
  window.parent.postMessage({ source: DEMO_PLAYER_SOURCE, type: 'demo:progress', scene, elapsedMs, durationMs }, '*')
}

export function postDemoEnded(scene: DemoSceneId, durationMs: number): void {
  window.parent.postMessage({ source: DEMO_PLAYER_SOURCE, type: 'demo:ended', scene, durationMs }, '*')
}

export function postDemoError(message: string): void {
  window.parent.postMessage({ source: DEMO_PLAYER_SOURCE, type: 'demo:error', message }, '*')
}
