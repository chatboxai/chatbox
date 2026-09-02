/**
 * Live Azure OpenAI / Microsoft Foundry integration test.
 *
 * Required environment variables:
 * AZURE_OPENAI_API_KEY=...
 * AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
 * AZURE_OPENAI_DEPLOYMENT_NAME=...
 * AZURE_OPENAI_API_VERSION=v1
 *
 * Run explicitly to avoid consuming Azure quota during normal test runs:
 * RUN_MODEL_PROVIDER_TESTS=1 RUN_AZURE_LIVE_TESTS=1 pnpm exec vitest run test/integration/model-provider/azure-live.test.ts --testTimeout=120000
 */
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import { settings as getDefaultSettings, newConfigs, SystemProviders } from '../../../src/shared/defaults'
import { getModel } from '../../../src/shared/providers'
import { ModelProviderEnum, type SessionSettings, type Settings } from '../../../src/shared/types'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

const shouldRun = process.env.RUN_AZURE_LIVE_TESTS === '1'
const apiKey = process.env.AZURE_OPENAI_API_KEY || ''
const endpoint = process.env.AZURE_OPENAI_ENDPOINT || ''
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || ''
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || ''

const requiredEnvironment = {
  AZURE_OPENAI_API_KEY: apiKey,
  AZURE_OPENAI_ENDPOINT: endpoint,
  AZURE_OPENAI_DEPLOYMENT_NAME: deploymentName,
  AZURE_OPENAI_API_VERSION: apiVersion,
}

describe.runIf(shouldRun)('Azure OpenAI live integration', () => {
  const missingEnvironment = Object.entries(requiredEnvironment)
    .filter(([, value]) => !value)
    .map(([name]) => name)

  it('has all required environment variables', () => {
    expect(missingEnvironment).toEqual([])
  })

  it.runIf(missingEnvironment.length === 0)('generates text through the configured deployment', async () => {
    const platform = new TestPlatform()
    const sentry = new MockSentryAdapter()
    const dependencies = await createMockModelDependencies(platform, sentry)
    const systemProvider = SystemProviders().find((provider) => provider.id === ModelProviderEnum.Azure)
    if (!systemProvider) throw new Error('Azure provider not found in SystemProviders')

    const globalSettings: Settings = {
      ...getDefaultSettings(),
      providers: {
        [ModelProviderEnum.Azure]: {
          ...systemProvider.defaultSettings,
          apiKey,
          endpoint,
          apiVersion,
          models: [{ modelId: deploymentName }],
        },
      },
    }
    const sessionSettings: SessionSettings = {
      provider: ModelProviderEnum.Azure,
      modelId: deploymentName,
      temperature: 0,
      maxTokens: 32,
      stream: true,
    }
    const messages: ModelMessage[] = [
      { role: 'system', content: 'Follow the user instruction exactly.' },
      { role: 'user', content: 'Reply with exactly AZURE_LIVE_OK' },
    ]

    const model = getModel(sessionSettings, globalSettings, newConfigs(), dependencies)
    const result = await model.chat(messages, {})
    const text = result.contentParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')

    expect(text).toContain('AZURE_LIVE_OK')
    expect(result.finishReason).toBe('stop')
  })
})
