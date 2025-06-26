import { ModelProvider, ModelProviderEnum, ProviderSettings, SessionType } from 'src/shared/types'
import { ModelSettingUtil } from './interface'
import HuaweiCloudMaaS from '../models/huaweicloud-maas'
import BaseConfig from './base-config'

export default class HuaweiCloudMAASSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.HuaweiCloudMaaS

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `HuaweiCloudMaaS API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  public getLocalOptionGroups() {
    // HuaweiCloudMaaS支持的所有模型

    const deepseekModels = [
      'deepseek-r1-250528',
      'DeepSeek-V3',
      'DeepSeek-R1'
    ]

    const qwenModels = [
      'qwen3-235b-a22b',
      'qwen3-32b'
    ]

    return [
      {
        group_name: 'DeepSeek 系列',
        options: deepseekModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
      {
        group_name: '千问 系列',
        options: qwenModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
    ]
  }

  protected async listProviderModels() {
    return []
  }

  isCurrentModelSupportImageInput(model: string): boolean {
    return HuaweiCloudMaaS.helpers.isModelSupportVision(model)
  }

  isCurrentModelSupportToolUse(model: string): boolean {
    return HuaweiCloudMaaS.helpers.isModelSupportToolUse(model)
  }
} 