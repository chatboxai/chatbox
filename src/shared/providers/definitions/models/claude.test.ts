import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ModelDependencies } from '@shared/types/adapters'
import type { SentryScope } from '@shared/utils/sentry_adapter'
import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Claude from './claude'

const providerMocks = vi.hoisted(() => {
  const languageModel: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }

  return {
    createAnthropic: vi.fn(() => ({
      languageModel: vi.fn(() => languageModel),
    })),
    streamText: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: providerMocks.createAnthropic,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: providerMocks.streamText,
  }
})

const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) =>
        callback({
          setTag: vi.fn(),
          setExtra: vi.fn(),
        })
      ),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
  }
}

function createModel(promptCacheTTL: '5m' | '1h' | undefined, stream: boolean): Claude {
  return new Claude(
    {
      claudeApiKey: 'test-key',
      claudeApiHost: 'https://api.anthropic.com/v1',
      model: {
        modelId: 'claude-sonnet-4-5',
        providerId: 'claude',
        capabilities: ['reasoning'],
      },
      promptCacheTTL,
      stream,
    },
    createDependencies()
  )
}

function mockEmptyStream(): void {
  providerMocks.streamText.mockReturnValue({
    fullStream: {
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ done: true as const, value: undefined }) }
      },
    },
    totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    finishReason: Promise.resolve('stop'),
  })
}

function getDispatchedCacheControl(): unknown {
  const dispatchedMessages = providerMocks.streamText.mock.calls[0]?.[0]?.messages
  const firstMessage = dispatchedMessages?.[0] as ModelMessage | undefined
  const anthropic = firstMessage?.providerOptions?.anthropic as Record<string, unknown> | undefined
  return anthropic?.cacheControl
}

describe('Claude prompt cache request preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmptyStream()
  })

  it('applies the selected TTL to non-streaming requests', async () => {
    await createModel('1h', false).chat(messages, {})

    expect(getDispatchedCacheControl()).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('applies the selected TTL to streaming requests', async () => {
    await createModel('5m', true).chatStream(messages, {}).next()

    expect(getDispatchedCacheControl()).toEqual({ type: 'ephemeral', ttl: '5m' })
  })

  it('keeps automatic requests on the provider default', async () => {
    await createModel(undefined, true).chatStream(messages, {}).next()

    expect(getDispatchedCacheControl()).toEqual({ type: 'ephemeral' })
  })
})
