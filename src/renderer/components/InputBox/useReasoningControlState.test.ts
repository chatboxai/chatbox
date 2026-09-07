import { ModelProviderType, type ProviderInfo } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { resolveReasoningModelInfo } from './useReasoningControlState'

function copilotProvider(models: ProviderInfo['models']): NonNullable<Parameters<typeof resolveReasoningModelInfo>[1]> {
  return {
    id: 'github-copilot',
    type: ModelProviderType.OpenAI,
    models,
  }
}

describe('resolveReasoningModelInfo for GitHub Copilot', () => {
  it('routes stored GPT-5.6 Luna records to openai-responses', () => {
    const info = resolveReasoningModelInfo(
      { provider: 'github-copilot', modelId: 'gpt-5.6-luna' },
      copilotProvider([{ modelId: 'gpt-5.6-luna' }])
    )

    expect(info?.apiStyle).toBe('openai-responses')
  })

  it('overwrites a persisted openai apiStyle on Responses-only Copilot models', () => {
    const info = resolveReasoningModelInfo(
      { provider: 'github-copilot', modelId: 'gpt-5.6-luna' },
      copilotProvider([{ modelId: 'gpt-5.6-luna', apiStyle: 'openai' }])
    )

    expect(info?.apiStyle).toBe('openai-responses')
  })

  it('keeps Chat Completions routing for Claude on Copilot', () => {
    const info = resolveReasoningModelInfo(
      { provider: 'github-copilot', modelId: 'claude-sonnet-5' },
      copilotProvider([{ modelId: 'claude-sonnet-5', apiStyle: 'openai-responses' }])
    )

    expect(info?.apiStyle).toBe('openai')
  })
})
