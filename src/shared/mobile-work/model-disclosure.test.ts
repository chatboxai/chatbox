import { describe, expect, it, vi } from 'vitest'
import { ModelProviderType } from '../types/provider'
import { workModelDisclosure } from './model-disclosure'

vi.mock('../providers/registry', () => ({
  getProviderDefinition: (id: string) => (id === 'chatbox-ai' ? { name: 'Chatbox AI' } : undefined),
}))

describe('work model disclosure', () => {
  it('shows the configured recipient and model name independently of its internal identity', () => {
    const settings = { provider: 'custom-provider-secret-id', modelId: 'gpt-4o' }
    const globalSettings = {
      customProviders: [
        { id: settings.provider, name: 'Company Gateway', isCustom: true as const, type: ModelProviderType.OpenAI },
      ],
      providers: { [settings.provider]: { models: [{ modelId: 'gpt-4o', nickname: 'Analysis Model' }] } },
    }
    expect(workModelDisclosure(settings, globalSettings)).toEqual({
      modelName: 'Company Gateway / Analysis Model',
      modelIdentity: JSON.stringify([settings.provider, settings.modelId]),
    })
    const renamed = {
      ...globalSettings,
      customProviders: [{ ...globalSettings.customProviders[0], name: 'Renamed Gateway' }],
    }
    expect(workModelDisclosure(settings, renamed).modelIdentity).toBe(
      workModelDisclosure(settings, globalSettings).modelIdentity
    )
  })

  it('resolves the default built-in provider', () => {
    expect(workModelDisclosure({ modelId: 'model' }, {})).toEqual({
      modelName: 'Chatbox AI / model',
      modelIdentity: JSON.stringify(['chatbox-ai', 'model']),
    })
  })
})
