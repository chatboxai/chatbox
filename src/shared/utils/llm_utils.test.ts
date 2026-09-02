import { describe, expect, it } from 'vitest'
import {
  normalizeAzureEndpoint,
  normalizeClaudeHost,
  normalizeGeminiHost,
  normalizeOpenAIApiHostAndPath,
} from './llm_utils'

describe('normalizeOpenAIApiHostAndPath', () => {
  it('returns defaults when apiHost is empty', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: '', apiPath: '' })
    expect(result.apiHost).toBe('https://api.openai.com/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('returns defaults when apiHost is undefined', () => {
    const result = normalizeOpenAIApiHostAndPath({})
    expect(result.apiHost).toBe('https://api.openai.com/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('strips trailing slash from apiHost', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com/v1/' })
    expect(result.apiHost).not.toMatch(/\/$/)
  })

  it('adds leading slash to apiPath', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com/v1', apiPath: 'chat/completions' })
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('adds https:// when protocol is missing', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'my-proxy.com/v1' })
    expect(result.apiHost).toMatch(/^https:\/\//)
  })

  it('preserves http:// protocol', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'http://localhost:8080/v1' })
    expect(result.apiHost).toBe('http://localhost:8080/v1')
  })

  it('normalizes mixed-case HTTP protocols from mobile keyboards', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'Http://192.168.1.10:11434' })
    expect(result.apiHost).toBe('http://192.168.1.10:11434/v1')
  })

  it('extracts path when user puts full URL in apiHost', () => {
    const result = normalizeOpenAIApiHostAndPath({
      apiHost: 'https://my-proxy.com/v1/chat/completions',
    })
    expect(result.apiHost).toBe('https://my-proxy.com/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('normalizes OpenAI host to default', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.openai.com' })
    expect(result.apiHost).toBe('https://api.openai.com/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('normalizes OpenRouter host', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://openrouter.ai' })
    expect(result.apiHost).toBe('https://openrouter.ai/api/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('normalizes X API host', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://api.x.com' })
    expect(result.apiHost).toBe('https://api.x.com/v1')
    expect(result.apiPath).toBe('/chat/completions')
  })

  it('appends /v1 when missing from custom host', () => {
    const result = normalizeOpenAIApiHostAndPath({ apiHost: 'https://my-proxy.com' })
    expect(result.apiHost).toBe('https://my-proxy.com/v1')
  })

  it('accepts custom defaults', () => {
    const result = normalizeOpenAIApiHostAndPath({}, { apiHost: 'https://custom.api.com', apiPath: '/v2/chat' })
    expect(result.apiHost).toBe('https://custom.api.com')
    expect(result.apiPath).toBe('/v2/chat')
  })
})

describe('normalizeClaudeHost', () => {
  it('appends /v1 to default Anthropic host', () => {
    const result = normalizeClaudeHost('https://api.anthropic.com')
    expect(result.apiHost).toBe('https://api.anthropic.com/v1')
    expect(result.apiPath).toBe('/messages')
  })

  it('strips trailing slash', () => {
    const result = normalizeClaudeHost('https://my-proxy.com/')
    expect(result.apiHost).toBe('https://my-proxy.com')
  })

  it('trims whitespace', () => {
    const result = normalizeClaudeHost('  https://api.anthropic.com  ')
    expect(result.apiHost).toBe('https://api.anthropic.com/v1')
  })

  it('does not modify custom proxy host', () => {
    const result = normalizeClaudeHost('https://my-proxy.com/v1')
    expect(result.apiHost).toBe('https://my-proxy.com/v1')
  })
})

describe('normalizeGeminiHost', () => {
  it('appends /v1beta to host', () => {
    const result = normalizeGeminiHost('https://generativelanguage.googleapis.com')
    expect(result.apiHost).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(result.apiPath).toBe('/models/[model]')
  })

  it('strips trailing slash before appending', () => {
    const result = normalizeGeminiHost('https://generativelanguage.googleapis.com/')
    expect(result.apiHost).toBe('https://generativelanguage.googleapis.com/v1beta')
  })
})

describe('normalizeAzureEndpoint', () => {
  it('accepts an Azure resource name', () => {
    expect(normalizeAzureEndpoint('my-resource').endpoint).toBe('https://my-resource.openai.azure.com/openai')
  })

  it('accepts a standard Azure hostname without a scheme', () => {
    expect(normalizeAzureEndpoint('my-resource.openai.azure.com').endpoint).toBe(
      'https://my-resource.openai.azure.com/openai'
    )
  })

  it('accepts a custom gateway hostname without a scheme', () => {
    expect(normalizeAzureEndpoint('azure-gateway.example.com').endpoint).toBe(
      'https://azure-gateway.example.com/openai'
    )
  })

  it('preserves an explicit HTTP scheme for local gateways', () => {
    expect(normalizeAzureEndpoint(' http://localhost:8080/azure/path ').endpoint).toBe('http://localhost:8080/openai')
  })

  it('keeps the settings placeholder renderable', () => {
    expect(normalizeAzureEndpoint('https://<resource_name>.openai.azure.com').endpoint).toBe(
      'https://<resource_name>.openai.azure.com/openai'
    )
  })
})
