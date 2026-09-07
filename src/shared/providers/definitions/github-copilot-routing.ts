import type { ProviderModelInfo } from '../../types'

export type GitHubCopilotApiStyle = 'openai' | 'openai-responses'

/**
 * Copilot serves GPT-5.5+ and Codex models only on the Responses API.
 * Older GPT models and non-OpenAI vendors still accept /chat/completions.
 */
export function githubCopilotUsesResponsesApi(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (normalized.includes('codex')) {
    return true
  }

  const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(normalized)
  if (!match) {
    return false
  }

  const major = Number(match[1])
  const minor = Number(match[2] ?? '0')
  return major > 5 || (major === 5 && minor >= 5)
}

export function getGitHubCopilotApiStyle(modelId: string): GitHubCopilotApiStyle {
  return githubCopilotUsesResponsesApi(modelId) ? 'openai-responses' : 'openai'
}

export function applyGitHubCopilotModelMetadata(model: ProviderModelInfo): ProviderModelInfo {
  return {
    ...model,
    // Always overwrite: getModel() may stamp the provider type (`openai`) before
    // createModel runs, which would otherwise pin Responses-only models onto Chat Completions.
    apiStyle: getGitHubCopilotApiStyle(model.modelId),
  }
}

export function stampGitHubCopilotCatalog(models: ProviderModelInfo[]): ProviderModelInfo[] {
  return models.map(applyGitHubCopilotModelMetadata)
}
