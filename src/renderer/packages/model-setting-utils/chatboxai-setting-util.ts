import { ModelOptionGroup, ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class ChatboxAISettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.ChatboxAI

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    if (sessionType === 'picture') {
      return `Chatbox AI`
    } else {
      return `Chatbox AI (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
    }
  }

  protected async listProviderModels() {
    return []
  }

  protected mergeOptionGroups(localOptionGroups: ModelOptionGroup[], remoteOptionGroups: ModelOptionGroup[]) {
    const ret = [...remoteOptionGroups, ...localOptionGroups]
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
