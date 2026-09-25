import { describe, expect, it, vi } from 'vitest'
import { settings as defaults, newConfigs } from '../defaults'
import { convertToModelMessages } from '../services/model-message-converter'
import { supportsToolResultImages } from '../tools/view-image'
import { type Message, ModelProviderEnum, ModelProviderType, type ProviderSettings, type Settings } from '../types'
import type { ModelDependencies } from '../types/adapters'
import { resolveReasoningReplayPolicy } from '../utils/reasoning-control'
import { getModel } from './index'

const dependencies: ModelDependencies = {
  platformType: 'desktop',
  request: { apiRequest: vi.fn(), fetchWithOptions: vi.fn() },
  storage: { saveImage: vi.fn(), getImage: vi.fn() },
  sentry: { captureException: vi.fn(), withScope: vi.fn() },
  getRemoteConfig: () => ({}),
}

function model(provider = 'openai-responses', overrides: ProviderSettings = {}, modelId = 'gpt-5.6-sol') {
  const settings: Settings = {
    ...defaults(),
    providers: {
      [provider]: { apiKey: 'test-key', apiHost: 'https://gateway.example/v1', ...overrides, models: [{ modelId }] },
    },
    customProviders: ['custom-a', 'custom-b'].map((id) => ({
      id,
      name: id,
      type: ModelProviderType.OpenAIResponses,
      isCustom: true,
    })),
  }
  return getModel({ provider, modelId }, settings, newConfigs(), dependencies)
}

describe('encrypted reasoning source isolation', () => {
  it('identifies OpenAI OAuth as Responses without changing xAI capabilities', () => {
    const oauth = model('openai', { activeAuthMode: 'oauth', oauth: { accessToken: 'oauth-token' } })
    expect(oauth.apiStyle).toBe('openai-responses')
    expect(oauth.reasoningReplaySource).toBeTruthy()
    const xai = model(ModelProviderEnum.XAI, {}, 'grok-4')
    expect(xai.apiStyle).toBe('openai')
    expect(xai.reasoningReplaySource).toBeUndefined()
    expect(supportsToolResultImages(xai.apiStyle)).toBe(false)
    expect(
      resolveReasoningReplayPolicy(ModelProviderEnum.XAI, { modelId: xai.modelId, apiStyle: xai.apiStyle })
        .preserveReasoning
    ).toBe(false)
  })

  it('has a stable opaque binding and changes with credentials, account, endpoint, model or provider', () => {
    const source = model().reasoningReplaySource
    expect(source).toBeTruthy()
    expect(source).toBe(model().reasoningReplaySource)
    expect(source).not.toContain('test-key')
    const variants = [
      model('openai-responses', { apiKey: 'other-key' }),
      model('openai-responses', { apiHost: 'https://other.example/v1' }),
      model('openai-responses', { apiPath: '/other/responses' }),
      model('openai-responses', {}, 'gpt-5.6-terra'),
      model('github-copilot'),
      model('opencode-zen'),
      model('opencode-go'),
      model('custom-a'),
      model('custom-b'),
      model('openai', { activeAuthMode: 'oauth', oauth: { accessToken: 'token', extra: { accountId: 'a' } } }),
    ]
    for (const variant of variants) {
      expect(variant.reasoningReplaySource).toBeTruthy()
      expect(variant.reasoningReplaySource).not.toBe(source)
    }
    const oauth = (token: string, accountId: string) =>
      model('openai', { activeAuthMode: 'oauth', oauth: { accessToken: token, extra: { accountId } } })
        .reasoningReplaySource
    expect(oauth('token', 'a')).not.toBe(oauth('token', 'b'))
    expect(oauth('token', 'a')).toBe(oauth('refreshed-token', 'a'))
    const accountlessOAuth = (token: string) =>
      model('openai', { activeAuthMode: 'oauth', oauth: { accessToken: token } }).reasoningReplaySource
    expect(accountlessOAuth('token')).not.toBe(accountlessOAuth('refreshed-token'))
  })

  it('binds ChatboxAI ciphertext to the license identity', () => {
    const create = (licenseKey: string) =>
      getModel(
        { provider: ModelProviderEnum.ChatboxAI, modelId: 'responses-model' },
        {
          ...defaults(),
          licenseKey,
          providers: {
            [ModelProviderEnum.ChatboxAI]: { models: [{ modelId: 'responses-model', apiStyle: 'openai-responses' }] },
          },
        },
        newConfigs(),
        dependencies
      )
    expect(create('license-a').reasoningReplaySource).toBeTruthy()
    expect(create('license-a').reasoningReplaySource).not.toBe(create('license-b').reasoningReplaySource)
  })

  it('only emits ciphertext for matching provenance and never sends the local marker', async () => {
    const origin = model()
    const messages: Message[] = [
      {
        id: 'answer',
        role: 'assistant',
        contentParts: [
          {
            type: 'reasoning',
            text: '',
            protocolOnly: true,
            providerMetadata: {
              openai: {
                itemId: 'rs_1',
                reasoningEncryptedContent: 'encrypted',
                chatboxReplaySource: origin.reasoningReplaySource,
              },
            },
          },
          { type: 'text', text: 'Answer' },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call_1',
            toolName: 'lookup',
            args: {},
            result: { value: 7 },
          },
        ],
      },
    ]
    const convert = (source: string | undefined) =>
      convertToModelMessages(messages, async () => null, {
        modelSupportVision: false,
        preserveReasoning: 'all-turns',
        signedReasoningOnly: true,
        replayNamespaces: ['openai'],
        reasoningReplaySource: source,
      })
    const same = JSON.stringify(await convert(origin.reasoningReplaySource))
    expect(same).toContain('encrypted')
    expect(same).not.toContain('chatboxReplaySource')
    for (const source of [
      undefined,
      model('github-copilot').reasoningReplaySource,
      model('custom-a').reasoningReplaySource,
      model('openai-responses', { apiKey: 'other' }).reasoningReplaySource,
    ]) {
      const foreign = JSON.stringify(await convert(source))
      expect(foreign).not.toContain('encrypted')
      expect(foreign).not.toContain('rs_1')
      expect(foreign).toContain('Answer')
      expect(foreign).toContain('lookup')
    }
    const reasoning = messages[0].contentParts[0]
    if (reasoning.type !== 'reasoning') throw new Error('Expected reasoning fixture')
    delete reasoning.providerMetadata?.openai.chatboxReplaySource
    expect(JSON.stringify(await convert(origin.reasoningReplaySource))).not.toContain('encrypted')
  })
})
