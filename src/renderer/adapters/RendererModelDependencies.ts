import { isDesktopLikePlatform } from '@shared/platform'
import { createAfetch } from '@shared/request/request'
import type { ModelDependencies, OAuthAdapter, RequestAdapter, StorageAdapter } from '@shared/types/adapters'
import type { SentryAdapter } from '@shared/utils/sentry_adapter'
import { getOS } from '@/packages/navigator'
import platform from '@/platform'
import type { PlatformType } from '@/platform/interfaces'
import { settingsService } from '@/settings-runtime'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as settingActions from '@/stores/settingActions'
import { apiRequest } from '@/utils/request'
import { type ModelBlobStorage, RendererModelStorageAdapter } from './RendererModelStorageAdapter'
import { type OAuthIpcInvoker, RendererOAuthAdapter } from './RendererOAuthAdapter'
import { type RendererApiRequestClient, RendererRequestAdapter } from './RendererRequestAdapter'
import { RendererSentryAdapter } from './sentry'

export interface ModelDependencyPlatformInfo {
  type: PlatformType
  platform: string
  os: string
  version: string
}

export interface CreateModelDependenciesOptions {
  platformInfo?: ModelDependencyPlatformInfo
  platformType?: ModelDependencies['platformType']
  storage?: StorageAdapter
  blobStorage?: ModelBlobStorage
  createPictureStorageKey?: (folder: string) => string
  request?: RequestAdapter
  apiRequestClient?: RendererApiRequestClient
  sentry?: SentryAdapter
  getRemoteConfig?: ModelDependencies['getRemoteConfig']
  oauth?: OAuthAdapter
  oauthIpc?: OAuthIpcInvoker
}

async function createDefaultPlatformInfo(): Promise<ModelDependencyPlatformInfo> {
  return {
    type: platform.type,
    platform: await platform.getPlatform(),
    os: getOS(),
    version: (await platform.getVersion()) || 'unknown',
  }
}

function createStorageAdapter(options: CreateModelDependenciesOptions): StorageAdapter {
  if (options.storage) return options.storage
  return new RendererModelStorageAdapter(
    options.blobStorage ?? storage,
    options.createPictureStorageKey ?? StorageKeyGenerator.picture
  )
}

function createRequestAdapter(
  platformInfo: ModelDependencyPlatformInfo,
  apiRequestClient: RendererApiRequestClient = apiRequest
): RequestAdapter {
  return new RendererRequestAdapter(createAfetch(platformInfo), apiRequestClient)
}

function getDefaultOAuthIpc(): OAuthIpcInvoker {
  const maybeDesktopPlatform = platform as unknown as { ipc?: OAuthIpcInvoker }
  if (!maybeDesktopPlatform.ipc) {
    throw new Error('OAuth IPC is only available on desktop')
  }
  return maybeDesktopPlatform.ipc
}

export async function createModelDependencies(
  options: CreateModelDependenciesOptions = {}
): Promise<ModelDependencies> {
  const platformInfo = options.platformInfo ?? (await createDefaultPlatformInfo())
  const platformType = options.platformType ?? platformInfo.type

  return {
    storage: createStorageAdapter(options),
    request: options.request ?? createRequestAdapter(platformInfo, options.apiRequestClient),
    sentry: options.sentry ?? new RendererSentryAdapter(),
    getRemoteConfig: options.getRemoteConfig ?? settingActions.getRemoteConfig,
    oauth:
      options.oauth ??
      (isDesktopLikePlatform(platformType)
        ? new RendererOAuthAdapter(settingsService, () => options.oauthIpc ?? getDefaultOAuthIpc())
        : undefined),
    platformType,
  }
}
