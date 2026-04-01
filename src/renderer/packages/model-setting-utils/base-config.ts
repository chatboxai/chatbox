import * as Sentry from '@sentry/react'
import { getProviderDefinition } from '../../../shared/providers'
import type {
  ModelProvider,
  ProviderBaseInfo,
  ProviderModelInfo,
  ProviderSettings,
  SessionType,
} from '../../../shared/types'
import {
  enrichModelsFromRegistry,
  getDiscoveredModels,
  getProviderModelsFromRegistry,
  getRegistry,
} from '../../packages/model-registry'
import * as remote from '../../packages/remote'
import type { ModelSettingUtil } from './interface'

export default abstract class BaseConfig implements ModelSettingUtil {
  public abstract provider: ModelProvider
  public abstract getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    providerBaseInfo?: ProviderBaseInfo
  ): Promise<string>

  protected abstract listProviderModels(settings: ProviderSettings): Promise<ProviderModelInfo[]>

  private async listRemoteProviderModels(): Promise<ProviderModelInfo[]> {
    return await remote
      .getModelManifest({
        aiProvider: this.provider,
      })
      .then((res) => {
        return Array.isArray(res.models) ? res.models : []
      })
      .catch(() => {
        return []
      })
  }

  // 有四个来源：本地写死、后端配置、服务商模型列表、models.dev registry（fallback + enrichment）
  public async getMergeOptionGroups(providerSettings: ProviderSettings): Promise<ProviderModelInfo[]> {
    const definition = getProviderDefinition(this.provider)
    if (definition?.modelsDevProviderId) {
      await getRegistry()
    }

    const localOptionGroups = providerSettings.models || []
    const [remoteModels, providerApiModels] = await Promise.all([
      this.listRemoteProviderModels().catch((e) => {
        Sentry.captureException(e)
        return []
      }),
      this.listProviderModels(providerSettings).catch((e) => {
        Sentry.captureException(e)
        return []
      }),
    ])

    const safeRemoteModels = Array.isArray(remoteModels) ? remoteModels : []
    let safeProviderModels = Array.isArray(providerApiModels) ? providerApiModels : []

    // Fallback: 当 provider API 返回空时，使用 models.dev registry 的 curated model list
    let usedRegistryFallback = false
    if (safeProviderModels.length === 0 && definition?.modelsDevProviderId && definition?.curatedModelIds) {
      const registryModels = getProviderModelsFromRegistry(this.provider)
      if (registryModels.length > 0) {
        // 只使用 curated models 作为 fallback（不包含所有 registry models）
        const curatedSet = new Set(definition.curatedModelIds.map((id) => id.toLowerCase()))
        safeProviderModels = registryModels.filter((m) => curatedSet.has(m.modelId.toLowerCase()))
        usedRegistryFallback = true
      }
    }

    const remoteOptionGroups = [...safeRemoteModels, ...safeProviderModels]
    const mergedModels = this.mergeOptionGroups(localOptionGroups, remoteOptionGroups)

    // 使用 models.dev registry 丰富模型元数据（同步，无网络调用）
    const enrichedModels = enrichModelsFromRegistry(mergedModels, this.provider)

    // 追加近期发布的 discovered models（不在 curated list 中的新 model）
    // 仅当 provider API 成功返回时才追加（fallback 路径下不追加未经确认的模型）
    if (!usedRegistryFallback && definition?.modelsDevProviderId && definition?.curatedModelIds) {
      const existingIds = enrichedModels.map((m) => m.modelId)
      const discovered = getDiscoveredModels(this.provider, definition.curatedModelIds, existingIds)
      if (discovered.length > 0) {
        enrichedModels.push(...discovered)
      }
    }

    return enrichedModels
  }

  /**
   * 合并本地与远程的模型选项组。
   * 本地模型优先，远程模型中与本地重复的会被过滤。
   * @param localOptionGroups 本地模型选项组
   * @param remoteOptionGroups 远程模型选项组
   * @returns
   */
  protected mergeOptionGroups(localOptionGroups: ProviderModelInfo[], remoteOptionGroups: ProviderModelInfo[]) {
    // 创建本地模型的映射，用于快速查找
    const localModelMap = new Map<string, ProviderModelInfo>()
    for (const model of localOptionGroups) {
      localModelMap.set(model.modelId, model)
    }

    const mergedModels: ProviderModelInfo[] = []
    const processedModelIds = new Set<string>()

    // 先添加所有本地模型
    for (const model of localOptionGroups) {
      mergedModels.push(model)
      processedModelIds.add(model.modelId)
    }

    // 处理远程模型
    for (const remoteModel of remoteOptionGroups) {
      if (!processedModelIds.has(remoteModel.modelId)) {
        // 新的远程模型，直接添加
        mergedModels.push(remoteModel)
        processedModelIds.add(remoteModel.modelId)
      }
    }

    return mergedModels
  }
}
