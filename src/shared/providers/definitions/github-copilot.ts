// Stub for GitHub Copilot provider.
// The full implementation exists only in the official (non-OSS) edition.
// This stub registers a minimal provider definition so the open-source
// build does not fail on the side-effect import in providers/index.ts.
import { ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

export const githubCopilotProvider = defineProvider({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://github.com/features/copilot',
  },
  defaultSettings: {
    apiHost: 'https://api.githubcopilot.com',
    models: [],
  },
  createModel: (config) => {
    return new OpenAI(
      {
        apiKey: config.providerSetting.apiKey || '',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
})
