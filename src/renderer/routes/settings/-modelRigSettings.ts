import type { Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import type { DocumentParserType } from '@shared/types/settings'
import type { WebSearchProviderValue } from '@/packages/web-search/constants'

export const MODEL_RIG_SLOT_IDS = [
  'llm',
  'fast',
  'ocr',
  'parser',
  'asr',
  'embedding',
  'rerank',
  'search',
  'image',
  'tts',
] as const

export type ModelRigSlotId = (typeof MODEL_RIG_SLOT_IDS)[number]

export type ModelRef = { provider: string; model: string }

export type PictureRef = { provider: string; modelId: string }

export const FUTURE_SLOT_IDS: ReadonlySet<ModelRigSlotId> = new Set(['asr', 'tts'])

export const MODEL_SLOTS = ['llm', 'fast', 'ocr', 'embedding', 'rerank'] as const
export type ModelSlotId = (typeof MODEL_SLOTS)[number]

export const SEARCH_CUSTOM_FALLBACK: WebSearchProviderValue = 'bing'
export const PARSER_CUSTOM_FALLBACK: DocumentParserType = 'local'

export function isChatboxProvider(provider?: string) {
  return provider === ModelProviderEnum.ChatboxAI
}

export function isAutoOrChatbox(ref?: ModelRef) {
  return !ref || isChatboxProvider(ref.provider)
}

export function modelRefsEqual(a?: ModelRef, b?: ModelRef) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.provider === b.provider && a.model === b.model
}

export function effectiveParserType(settings: Settings, platformDefault: DocumentParserType): DocumentParserType {
  const type = settings.extension?.documentParser?.type
  if (!type || type === 'none') return platformDefault
  return type
}

export function customParserTypes(host: { isDesktopLike: boolean; isMobile: boolean }): DocumentParserType[] {
  const types: DocumentParserType[] = []
  if (host.isDesktopLike || host.isMobile) types.push('local')
  if (host.isDesktopLike) types.push('mineru')
  return types
}

export function isSlotPresetOn(
  slotId: ModelRigSlotId,
  settings: Settings,
  picture?: PictureRef,
  parserDefault: DocumentParserType = PARSER_CUSTOM_FALLBACK
): boolean {
  switch (slotId) {
    case 'llm':
      return isAutoOrChatbox(settings.defaultChatModel)
    case 'fast':
      return isAutoOrChatbox(settings.threadNamingModel) && isAutoOrChatbox(settings.searchTermConstructionModel)
    case 'ocr':
      return isAutoOrChatbox(settings.ocrModel)
    case 'embedding':
      return isAutoOrChatbox(settings.defaultEmbeddingModel)
    case 'rerank':
      return isAutoOrChatbox(settings.defaultRerankModel)
    case 'parser':
      return effectiveParserType(settings, parserDefault) === 'chatbox-ai'
    case 'search':
      return (settings.extension?.webSearch?.provider ?? 'build-in') === 'build-in'
    case 'image':
      return !picture || isChatboxProvider(picture.provider)
    case 'asr':
    case 'tts':
      return false
  }
}

export function getSlotModelRef(slotId: ModelSlotId, settings: Settings): ModelRef | undefined {
  switch (slotId) {
    case 'llm':
      return settings.defaultChatModel
    case 'fast':
      return settings.threadNamingModel ?? settings.searchTermConstructionModel
    case 'ocr':
      return settings.ocrModel
    case 'embedding':
      return settings.defaultEmbeddingModel
    case 'rerank':
      return settings.defaultRerankModel
  }
}

export function settingsPatchForModelSlot(slotId: ModelSlotId, selection: ModelRef | undefined): Partial<Settings> {
  switch (slotId) {
    case 'llm':
      return { defaultChatModel: selection }
    case 'fast':
      return { threadNamingModel: selection, searchTermConstructionModel: selection }
    case 'ocr':
      return { ocrModel: selection }
    case 'embedding':
      return { defaultEmbeddingModel: selection }
    case 'rerank':
      return { defaultRerankModel: selection }
  }
}

export function searchProvider(settings: Settings): WebSearchProviderValue {
  return (settings.extension?.webSearch?.provider ?? 'build-in') as WebSearchProviderValue
}

export function applyAllPresetsSettings(): Pick<
  Settings,
  | 'defaultChatModel'
  | 'threadNamingModel'
  | 'searchTermConstructionModel'
  | 'ocrModel'
  | 'defaultEmbeddingModel'
  | 'defaultRerankModel'
> {
  return {
    defaultChatModel: undefined,
    threadNamingModel: undefined,
    searchTermConstructionModel: undefined,
    ocrModel: undefined,
    defaultEmbeddingModel: undefined,
    defaultRerankModel: undefined,
  }
}

export function applyAllPresetsExtension(settings: Settings): Settings['extension'] {
  return {
    ...settings.extension,
    documentParser: {
      ...settings.extension.documentParser,
      type: 'chatbox-ai',
    },
    webSearch: {
      ...settings.extension.webSearch,
      provider: 'build-in',
    },
  }
}

export function extensionWithParserType(settings: Settings, type: DocumentParserType): Settings['extension'] {
  return {
    ...settings.extension,
    documentParser: {
      ...settings.extension.documentParser,
      type,
    },
  }
}

export function extensionWithSearchProvider(
  settings: Settings,
  provider: WebSearchProviderValue
): Settings['extension'] {
  return {
    ...settings.extension,
    webSearch: {
      ...settings.extension.webSearch,
      provider,
    },
  }
}

export function describeError(error: unknown): { error: string; fix: string } {
  const raw = error as { responseBody?: string; message?: string }
  const msg = (raw?.responseBody || raw?.message || (typeof error === 'string' ? error : String(error))).trim()
  if (/401|unauthorized|invalid api|api key/i.test(msg)) {
    return {
      error: 'Authentication failed',
      fix: 'Check the API key in Model Provider settings, or choose another model.',
    }
  }
  if (/timeout|etimedout|timed out|network|enotfound|fetch failed/i.test(msg)) {
    return {
      error: 'Connection timed out',
      fix: 'Check the network and the provider endpoint, or choose another model.',
    }
  }
  if (/license|activate chatbox/i.test(msg)) {
    return {
      error: 'Chatbox AI is not activated',
      fix: 'Activate Chatbox AI in Chatbox AI settings, or use your own model.',
    }
  }
  return {
    error: msg.slice(0, 220) || 'This configuration could not be verified',
    fix: 'Check the selected model and provider settings.',
  }
}
