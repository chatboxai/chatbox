import { describe, expect, it } from 'vitest'
import { hasDistinctModelAndProviderLogos } from './model-logo-resolver'

describe('hasDistinctModelAndProviderLogos', () => {
  it.each([
    ['gpt-4o', 'openrouter'],
    ['claude-sonnet-4', 'chatbox-ai'],
    ['gemini-2.5-pro', 'custom-provider'],
    ['llama-3.3-70b-versatile', 'groq'],
    ['kimi-k2', 'openrouter'],
    ['command-r-plus', 'custom-provider'],
    ['doubao-1.5-pro', 'siliconflow'],
  ])('shows the supplier for %s served by %s', (model, provider) => {
    expect(hasDistinctModelAndProviderLogos(model, provider)).toBe(true)
  })

  it.each([
    ['gpt-4o', 'openai'],
    ['kimi-k2', 'moonshot-cn'],
    ['doubao-1.5-pro', 'volcengine'],
    ['zhipu-v1', 'zhipu-glm-coding-plan'],
    ['longcat-flash', 'longcat'],
    ['qwen3', 'qwen-portal'],
    ['minimax-m2', 'minimax-cn'],
    ['moonshot-v1', 'moonshot-cn'],
    ['unknown-model', 'custom-provider'],
    ['chatboxai-4', 'chatbox-ai'],
  ])('avoids duplicate logos for %s served by %s', (model, provider) => {
    expect(hasDistinctModelAndProviderLogos(model, provider)).toBe(false)
  })
})
