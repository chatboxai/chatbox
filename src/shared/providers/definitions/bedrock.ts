import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Bedrock from './models/bedrock'

export const bedrockProvider = defineProvider({
  id: ModelProviderEnum.Bedrock,
  name: 'AWS Bedrock',
  type: ModelProviderType.Claude,
  urls: {
    website: 'https://aws.amazon.com/bedrock/',
    docs: 'https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html',
  },
  defaultSettings: {
    region: 'us-east-1',
    models: [
      {
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        nickname: 'Claude Sonnet 4.5 (US)',
        type: 'chat',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        nickname: 'Claude Haiku 4.5 (US)',
        type: 'chat',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'us.amazon.nova-pro-v1:0',
        nickname: 'Amazon Nova Pro (US)',
        type: 'chat',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 300_000,
        maxOutput: 5_120,
      },
      {
        modelId: 'us.amazon.nova-lite-v1:0',
        nickname: 'Amazon Nova Lite (US)',
        type: 'chat',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 300_000,
        maxOutput: 5_120,
      },
    ],
  },
  createModel: (config) => {
    return new Bedrock(
      {
        accessKey: config.providerSetting.accessKey || '',
        secretKey: config.providerSetting.secretKey || '',
        sessionToken: config.providerSetting.sessionToken,
        region: config.providerSetting.region || 'us-east-1',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `AWS Bedrock (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
