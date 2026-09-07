import { createCopilotOAuthFetch, createOAuthCredentialManager } from '../../oauth'
import type { ProviderModelInfo } from '../../types'
import { ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import {
  applyGitHubCopilotModelMetadata,
  getGitHubCopilotApiStyle,
  stampGitHubCopilotCatalog,
} from './github-copilot-routing'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'

export {
  applyGitHubCopilotModelMetadata,
  getGitHubCopilotApiStyle,
  githubCopilotUsesResponsesApi,
  type GitHubCopilotApiStyle,
} from './github-copilot-routing'

// The Copilot API base URL (no /v1 prefix)
const COPILOT_API_HOST = 'https://api.githubcopilot.com'

// Headers required by GitHub Copilot API on every request
const COPILOT_API_HEADERS: Record<string, string> = {
  'Openai-Intent': 'conversation-edits',
}

function copilotModel(
  modelId: string,
  capabilities: NonNullable<ProviderModelInfo['capabilities']>
): ProviderModelInfo {
  return {
    modelId,
    capabilities,
    apiStyle: getGitHubCopilotApiStyle(modelId),
  }
}

class GitHubCopilotChat extends OpenAI {
  public async listModels(): Promise<ProviderModelInfo[]> {
    return stampGitHubCopilotCatalog(await super.listModels())
  }
}

class GitHubCopilotResponses extends OpenAIResponses {
  public async listModels(): Promise<ProviderModelInfo[]> {
    return stampGitHubCopilotCatalog(await super.listModels())
  }
}

export const githubCopilotProvider = defineProvider({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://github.com/features/copilot',
  },
  defaultSettings: {
    apiHost: COPILOT_API_HOST,
    models: [
      copilotModel('gpt-5.6-sol', ['vision', 'reasoning', 'tool_use']),
      copilotModel('gpt-5.6-terra', ['vision', 'reasoning', 'tool_use']),
      copilotModel('gpt-5.6-luna', ['vision', 'tool_use', 'reasoning']),
      copilotModel('gpt-5.3-codex', ['vision', 'reasoning', 'tool_use']),
      copilotModel('claude-sonnet-5', ['vision', 'reasoning', 'tool_use']),
      copilotModel('claude-haiku-4.5', ['vision', 'reasoning', 'tool_use']),
      copilotModel('gemini-3.6-flash', ['vision', 'reasoning', 'tool_use']),
      copilotModel('gemini-3.7-flash', ['vision', 'reasoning', 'tool_use']),
      copilotModel('kimi-k2.7-code', ['vision', 'reasoning', 'tool_use']),
    ],
  },
  createModel: (config) => {
    const model = applyGitHubCopilotModelMetadata(config.model)
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      'github-copilot',
      config.providerSetting,
      config.dependencies
    )
    const shared = {
      apiKey: isOAuth ? 'oauth-placeholder' : config.effectiveApiKey,
      apiHost: COPILOT_API_HOST,
      model,
      temperature: config.settings.temperature,
      topP: config.settings.topP,
      maxOutputTokens: config.settings.maxTokens,
      stream: config.settings.stream,
      useProxy: false,
      skipHostNormalization: true,
      extraHeaders: COPILOT_API_HEADERS,
      customFetch:
        isOAuth && credentialManager ? createCopilotOAuthFetch(config.dependencies, credentialManager) : undefined,
      listModelsFallback: isOAuth
        ? config.providerSetting.models || githubCopilotProvider.defaultSettings?.models
        : undefined,
      skipRemoteModelList: isOAuth,
    }

    if (model.apiStyle === 'openai-responses') {
      return new GitHubCopilotResponses({ ...shared, apiPath: '/responses' }, config.dependencies)
    }

    return new GitHubCopilotChat(
      {
        ...shared,
        dalleStyle: 'vivid',
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `GitHub Copilot (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
