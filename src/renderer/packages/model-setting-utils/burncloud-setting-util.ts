import { ModelProvider, ProviderSettings, SessionType } from 'src/shared/types'
import { ModelSettingUtil } from './interface'
import BurnCloud from '../models/burncloud'
import BaseConfig from './base-config'

export default class BurnCloudSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProvider.BurnCloud
  
  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    if (sessionType === 'picture') {
      return `BurnCloud API (DALL-E-3)`
    } else {
      return `BurnCloud API (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
    }
  }

  public getLocalOptionGroups() {
    // BurnCloud支持的所有模型
    const claudeModels = [
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
    ]
    
    const gptModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'gpt-4.5-preview',
      'o1-mini',
    ]
    
    const imageModels = [
      'gpt-image-1',
    ]
    
    const geminiModels = [
      'gemini-2.5-pro-preview-05-06',
      'gemini-2.0',
    ]
    
    const deepseekModels = [
      'deepseek-r1',
      'deepseek-v3',
    ]
    
    return [
      {
        group_name: 'Claude 系列',
        options: claudeModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
      {
        group_name: 'GPT 系列',
        options: gptModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
      {
        group_name: '图像生成',
        options: imageModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
      {
        group_name: 'Gemini 系列',
        options: geminiModels.map((value) => ({
          label: value,
          value: value,
        })),
        collapsable: true,
      },
      {
        group_name: 'DeepSeek 系列',
        options: deepseekModels.map((value) => ({
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
    return BurnCloud.helpers.isModelSupportVision(model)
  }

  isCurrentModelSupportToolUse(model: string): boolean {
    return BurnCloud.helpers.isModelSupportToolUse(model)
  }
} 