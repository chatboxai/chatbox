import { ModelOptionGroup, ModelProvider, ProviderBaseInfo, ProviderSettings, SessionType } from '../../../shared/types'
import * as Sentry from '@sentry/react'
import * as remote from '../../packages/remote'
import { ModelSettingUtil } from './interface'

export default abstract class BaseConfig implements ModelSettingUtil {
  public abstract provider: ModelProvider
  public abstract getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    providerBaseInfo?: ProviderBaseInfo,
  ): Promise<string>

  protected abstract listProviderModels(settings: ProviderSettings): Promise<string[]>

  private listRemoteProviderModels(): Promise<string[]> {
    return remote
      .getModelConfigsWithCache({
        aiProvider: this.provider,
      })
      .then((res) => {
        return res.option_groups
          .map((group) => group.options)
          .flat()
          .map((o) => o.value)
      })
  }

  // 有三个来源：本地写死、后端配置、服务商模型列表
  public async getMergeOptionGroups(providerSettings: ProviderSettings): Promise<ModelOptionGroup[]> {
    const localOptionGroups = (providerSettings.models || []).map((model) => ({
      options: [{ label: model.nickname || model.modelId, value: model.modelId }],
    }))
    const [remoteModels, models] = await Promise.all([
      this.listRemoteProviderModels().catch((e) => {
        Sentry.captureException(e)
        return []
      }),
      this.listProviderModels(providerSettings).catch((e) => {
        Sentry.captureException(e)
        return []
      }),
    ])
    const remoteOptionGroups = [
      ...remoteModels.map((model) => ({ options: [{ label: model, value: model }] })),
      ...models.map((model) => ({ options: [{ label: model, value: model }] })),
    ]
    return this.mergeOptionGroups(localOptionGroups, remoteOptionGroups)
  }

  /**
   * 合并本地与远程的模型选项组。
   * 在返回的选项组中，本地选项组中独有的选项将会出现在第一个选项组，其余选项组将为远程选项组。
   * @param localOptionGroups 本地模型选项组
   * @param remoteOptionGroups 远程模型选项组
   * @returns
   */
  protected mergeOptionGroups(localOptionGroups: ModelOptionGroup[], remoteOptionGroups: ModelOptionGroup[]) {
    const ret = [...localOptionGroups, ...remoteOptionGroups]
    const existedOptionSet = new Set<string>()
    for (const group of ret) {
      group.options = group.options.filter((option) => {
        const existed = existedOptionSet.has(option.value)
        existedOptionSet.add(option.value)
        return !existed
      })
    }
    return ret.filter((group) => group.options.length > 0)
  }
}
