import {
  buildImageModelGroups,
  getConfiguredImageProviders,
  type RemoteImageModels,
  isOpenAIImageGenerationAuthSupported as supportsOpenAIImageAuth,
} from '@chatbox/core/application/image-generation'
import { mergeSharedOAuthProviderSettings } from '@shared/oauth'
import type { PlatformType } from '@shared/platform'
import {
  type ImageGenerationModel,
  type ImageModelCapabilities,
  ModelProviderEnum,
  ModelProviderType,
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

export { manualImageModelToOption, mergeImageModels } from '@chatbox/core/application/image-generation'

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

export function isOpenAIImageGenerationAuthSupported(
  providers: Settings['providers'],
  platformType: PlatformType = platform.type
): boolean {
  return supportsOpenAIImageAuth(providers, platformType)
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

/** Shares the image picker projection with native hosts and non-React generation consumers. */
export async function getAvailableImageModels(
  settings: Settings = settingsStore.getState()
): Promise<AvailableImageModel[]> {
  const providers = getConfiguredImageProviders(
    [
      ...[
        ModelProviderEnum.ChatboxAI,
        ModelProviderEnum.Gemini,
        ModelProviderEnum.OpenAI,
        ModelProviderEnum.OpenRouter,
      ].map((id) => ({ id, name: id })),
      ...(settings.customProviders ?? []),
    ],
    settings,
    platform.type
  )
  const remoteProviders = [
    ModelProviderEnum.ChatboxAI,
    ModelProviderEnum.Gemini,
    ModelProviderEnum.OpenAI,
    ModelProviderEnum.OpenRouter,
  ].filter(
    (id) =>
      (id !== ModelProviderEnum.OpenAI || isOpenAIImageGenerationAuthSupported(settings.providers)) &&
      providers.some(
        (provider) =>
          provider.id === id ||
          (id === ModelProviderEnum.Gemini && provider.isCustom && provider.type === ModelProviderType.Gemini)
      )
  )
  const remoteModels: RemoteImageModels = {}
  await Promise.all(
    remoteProviders.map(async (provider) => {
      remoteModels[provider] = await loadRemoteModels(provider, settings)
    })
  )
  return buildImageModelGroups({ providers, settings, platform: platform.type, remoteModels }).flatMap((group) =>
    group.models.map((model) => ({
      provider: group.providerId,
      modelId: model.modelId,
      nickname: model.displayName,
      ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    }))
  )
}
