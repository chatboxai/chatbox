export const DEMO_PARENT_SOURCE = 'chatbox-website'
export const DEMO_PLAYER_SOURCE = 'chatbox-demo'
export const DEMO_PROTOCOL_VERSION = 1 as const

export const DEMO_SCENE_MANIFEST = [
  { id: 'file-image-chat', label: 'File & Image Chat', durationMs: 8_500 },
  { id: 'web-search', label: 'Live Web Search', durationMs: 9_000 },
  { id: 'knowledge-base', label: 'Knowledge Base', durationMs: 9_500 },
  { id: 'rich-formatting', label: 'Rich Formatting', durationMs: 6_200 },
  { id: 'code-preview', label: 'Code & Preview', durationMs: 10_500 },
  { id: 'image-generation', label: 'Image Generation', durationMs: 11_000 },
] as const

export type DemoSceneId = (typeof DEMO_SCENE_MANIFEST)[number]['id']

export const DEMO_SCENES: readonly DemoSceneId[] = DEMO_SCENE_MANIFEST.map(({ id }) => id)

export function getSceneDurationMs(scene: DemoSceneId): number {
  const config = DEMO_SCENE_MANIFEST.find(({ id }) => id === scene)
  if (!config) throw new Error(`demo scene config missing for ${scene}`)
  return config.durationMs
}

export const DEMO_LANGS = [
  'en',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'de',
  'fr',
  'ru',
  'pt-PT',
  'es',
  'it-IT',
  'ar',
  'sv',
  'nb-NO',
] as const

export type DemoLang = (typeof DEMO_LANGS)[number]

export type DemoLayout = 'desktop' | 'mobile'

export type DemoManifest = {
  protocolVersion: typeof DEMO_PROTOCOL_VERSION
  scenes: ReadonlyArray<{ id: DemoSceneId; label: string; durationMs: number }>
  languages: readonly DemoLang[]
}

export const DEMO_MANIFEST: DemoManifest = {
  protocolVersion: DEMO_PROTOCOL_VERSION,
  scenes: DEMO_SCENE_MANIFEST,
  languages: DEMO_LANGS,
}

export type DemoParentMessage =
  | { source: typeof DEMO_PARENT_SOURCE; type: 'demo:set-scene'; scene: DemoSceneId }
  | { source: typeof DEMO_PARENT_SOURCE; type: 'demo:pause' }
  | { source: typeof DEMO_PARENT_SOURCE; type: 'demo:play' }
  | { source: typeof DEMO_PARENT_SOURCE; type: 'demo:set-lang'; lang: DemoLang }
  | { source: typeof DEMO_PARENT_SOURCE; type: 'demo:set-layout'; layout: DemoLayout }

export type DemoPlayerMessage =
  | {
      source: typeof DEMO_PLAYER_SOURCE
      type: 'demo:ready'
      manifest: DemoManifest
      scene: DemoSceneId
      elapsedMs: number
      durationMs: number
    }
  | {
      source: typeof DEMO_PLAYER_SOURCE
      type: 'demo:scene' | 'demo:progress'
      scene: DemoSceneId
      elapsedMs: number
      durationMs: number
    }
  | { source: typeof DEMO_PLAYER_SOURCE; type: 'demo:ended'; scene: DemoSceneId; durationMs: number }
  | { source: typeof DEMO_PLAYER_SOURCE; type: 'demo:error'; message: string }

const DEMO_LANG_SET = new Set<DemoLang>(DEMO_LANGS)

export function isDemoSceneId(value: string): value is DemoSceneId {
  return (DEMO_SCENES as readonly string[]).includes(value)
}

export function isDemoLang(value: string): value is DemoLang {
  return DEMO_LANG_SET.has(value as DemoLang)
}

export function isDemoLayout(value: string): value is DemoLayout {
  return value === 'desktop' || value === 'mobile'
}

export function parseDemoSearch(search: string): { scene: DemoSceneId; lang: DemoLang; layout: DemoLayout | null } {
  const params = new URLSearchParams(search)
  const sceneParam = params.get('scene') ?? ''
  const langParam = params.get('lang') ?? ''
  const layoutParam = params.get('layout') ?? ''
  return {
    scene: isDemoSceneId(sceneParam) ? sceneParam : 'file-image-chat',
    lang: isDemoLang(langParam) ? langParam : 'en',
    layout: isDemoLayout(layoutParam) ? layoutParam : null,
  }
}

export function isDemoParentMessage(value: unknown): value is DemoParentMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as { source?: unknown; type?: unknown }
  return message.source === DEMO_PARENT_SOURCE && typeof message.type === 'string'
}
