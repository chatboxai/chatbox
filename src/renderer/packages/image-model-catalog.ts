import { isUsingOAuth, mergeSharedOAuthProviderSettings } from '@shared/oauth'
import type { PlatformType } from '@shared/platform'
import {
  type ImageGenerationModel,
  type ImageModelCapabilities,
  ModelProviderEnum,
  ModelProviderType,
  type ProviderModelInfo,
  type Settings,
} from '@shared/types'
import { queryOptions } from '@tanstack/react-query'
import { getLogger } from '@/lib/utils'
import type { RemoteModelInfo } from '@/packages/remote'
import platform from '@/platform'
import { queryClient } from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { type ImageModelCatalogOptions, type ImageModelOption, loadProviderImageModels } from './image-model-provider'

const log = getLogger('image-model-catalog')

export type { ImageModelOption } from './image-model-provider'

export interface AvailableImageModel {
  provider: string
  modelId: string
  nickname: string
  capabilities?: ImageModelCapabilities
}

export function remoteImageModelToOption(model: RemoteModelInfo): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.modelName || model.modelId,
  }
}

export function manualImageModelToOption(model: ProviderModelInfo): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.nickname || model.modelId,
  }
}

export function mergeImageModels(
  remoteModels: ImageModelOption[],
  manualModels: ImageModelOption[]
): ImageModelOption[] {
  const modelsById = new Map<string, ImageModelOption>()
  for (const model of remoteModels) modelsById.set(model.modelId, model)
  for (const model of manualModels) {
    modelsById.set(model.modelId, {
      ...modelsById.get(model.modelId),
      ...model,
    })
  }
  return [...modelsById.values()]
}

const credentialRevisions = new Map<ModelProviderEnum, { credential: string; revision: number }>()
let nextCredentialRevision = 0
let observingCredentials = false

function credentialRevision(provider: ModelProviderEnum, credential = ''): number {
  const current = credentialRevisions.get(provider)
  if (current?.credential === credential) return current.revision
  const revision = ++nextCredentialRevision
  credentialRevisions.set(provider, { credential, revision })
  return revision
}

function observeCredentials(): void {
  if (observingCredentials) return
  observingCredentials = true
  settingsStore.subscribe((settings, previous) => {
    const apiKey = settings.providers?.[ModelProviderEnum.OpenRouter]?.apiKey
    if (apiKey !== previous.providers?.[ModelProviderEnum.OpenRouter]?.apiKey) {
      credentialRevision(ModelProviderEnum.OpenRouter, apiKey)
    }
    if (settings.licenseKey !== previous.licenseKey) {
      credentialRevision(ModelProviderEnum.ChatboxAI, settings.licenseKey)
    }
  })
}

export function providerImageModelsQueryOptions(provider: ModelProviderEnum, options: ImageModelCatalogOptions = {}) {
  observeCredentials()
  const revision =
    provider === ModelProviderEnum.OpenRouter
      ? credentialRevision(provider, options.apiKey)
      : provider === ModelProviderEnum.ChatboxAI
        ? credentialRevision(provider, options.licenseKey)
        : 0
  return queryOptions({
    queryKey: ['provider-image-models', provider, options.language, revision],
    staleTime: 3600 * 1000,
    queryFn: () => loadProviderImageModels(provider, options),
  })
}

/** Cancelling a generation stops its wait while other catalog consumers keep their shared request. */
function waitForCatalog<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Image model lookup was cancelled.', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}

export async function getImageModelCapabilities(
  model: ImageGenerationModel,
  settings: Settings = settingsStore.getState(),
  signal?: AbortSignal
): Promise<ImageModelCapabilities | undefined> {
  signal?.throwIfAborted()
  if (model.provider !== ModelProviderEnum.OpenRouter) return undefined
  const models = await waitForCatalog(loadRemoteModels(ModelProviderEnum.OpenRouter, settings), signal)
  return models.find((option) => option.modelId === model.modelId)?.capabilities
}

function isBuiltinProviderConfigured(provider: ModelProviderEnum, settings: Settings): boolean {
  const providerSettings = mergeSharedOAuthProviderSettings(provider, settings.providers)
  return !!providerSettings.apiKey || isUsingOAuth(providerSettings, platform.type)
}

export function isOpenAIImageGenerationAuthSupported(
  providers: Settings['providers'],
  platformType: PlatformType = platform.type
): boolean {
  const providerSettings = mergeSharedOAuthProviderSettings(ModelProviderEnum.OpenAI, providers)
  return !isUsingOAuth(providerSettings, platformType)
}

function manualImageModels(settings: Settings, provider: string): ImageModelOption[] {
  return (settings.providers?.[provider]?.models ?? [])
    .filter((model) => model.type === 'image')
    .map(manualImageModelToOption)
}

async function loadRemoteModels(provider: ModelProviderEnum, settings: Settings): Promise<ImageModelOption[]> {
  try {
    const providerSettings = mergeSharedOAuthProviderSettings(provider, settings.providers)
    return await queryClient.fetchQuery(
      providerImageModelsQueryOptions(provider, {
        apiKey: provider === ModelProviderEnum.OpenRouter ? providerSettings.apiKey : undefined,
        language: settings.language,
        licenseKey: settings.licenseKey,
      })
    )
  } catch (error) {
    log.error(`Failed to load image model manifest for ${provider}:`, error)
    return []
  }
}

function catalogEntries(provider: string, models: ImageModelOption[]): AvailableImageModel[] {
  return models.map((model) => ({
    provider,
    modelId: model.modelId,
    nickname: model.displayName,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
  }))
}

/**
 * Builds the non-React image model catalog used by the image creator UI.
 * Remote manifest models and manually configured models follow the same merge
 * and provider-visibility rules as useImageModelGroups().
 */
export async function getAvailableImageModels(
  settings: Settings = settingsStore.getState()
): Promise<AvailableImageModel[]> {
  const catalog: AvailableImageModel[] = []

  if (settings.licenseKey) {
    const excluded = new Set(settings.providers?.[ModelProviderEnum.ChatboxAI]?.excludedModels ?? [])
    const chatboxModels = (await loadRemoteModels(ModelProviderEnum.ChatboxAI, settings)).filter(
      (model) => !excluded.has(model.modelId)
    )
    catalog.push(...catalogEntries(ModelProviderEnum.ChatboxAI, chatboxModels))
  }

  const geminiConfigured = isBuiltinProviderConfigured(ModelProviderEnum.Gemini, settings)
  const customGeminiProviders = (settings.customProviders ?? []).filter(
    (provider) =>
      provider.isCustom &&
      provider.type === ModelProviderType.Gemini &&
      (settings.providers?.[provider.id]?.models?.length ?? 0) > 0
  )
  if (geminiConfigured || customGeminiProviders.length > 0) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.Gemini, settings)
    if (geminiConfigured) {
      catalog.push(
        ...catalogEntries(
          ModelProviderEnum.Gemini,
          mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.Gemini))
        )
      )
    }
    for (const provider of customGeminiProviders) {
      catalog.push(
        ...catalogEntries(provider.id, mergeImageModels(remoteModels, manualImageModels(settings, provider.id)))
      )
    }
  }

  if (
    isBuiltinProviderConfigured(ModelProviderEnum.OpenAI, settings) &&
    isOpenAIImageGenerationAuthSupported(settings.providers)
  ) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.OpenAI, settings)
    catalog.push(
      ...catalogEntries(
        ModelProviderEnum.OpenAI,
        mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.OpenAI))
      )
    )
  }

  if (isBuiltinProviderConfigured(ModelProviderEnum.OpenRouter, settings)) {
    const remoteModels = await loadRemoteModels(ModelProviderEnum.OpenRouter, settings)
    catalog.push(
      ...catalogEntries(
        ModelProviderEnum.OpenRouter,
        mergeImageModels(remoteModels, manualImageModels(settings, ModelProviderEnum.OpenRouter))
      )
    )
  }

  for (const provider of customOpenAICompatibleImageProviders(settings)) {
    catalog.push(...catalogEntries(provider.id, manualImageModels(settings, provider.id)))
  }

  return catalog
}

function isOpenAICompatibleCustomProviderType(type: ModelProviderType | undefined) {
  return type === ModelProviderType.OpenAI || type === ModelProviderType.OpenAIResponses || type === undefined
}

function customOpenAICompatibleImageProviders(settings: Settings) {
  return (settings.customProviders ?? []).filter(
    (provider) =>
      provider.isCustom &&
      isOpenAICompatibleCustomProviderType(provider.type) &&
      manualImageModels(settings, provider.id).length > 0
  )
}
