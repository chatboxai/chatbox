import { describe, expect, it } from 'vitest'
import { createDefaultSettings, ModelProviderType } from '../../domain/settings'
import { projectProviderCatalog } from '../../model'

describe('projectProviderCatalog', () => {
  it('keeps catalog, configuration, runtime support and selectability distinct', () => {
    const settings = createDefaultSettings()
    settings.providers = {
      openai: {
        apiKey: 'key',
        models: [{ modelId: 'gpt-test' }],
      },
    }

    const openai = projectProviderCatalog(settings, 'mobile').find((provider) => provider.id === 'openai')

    expect(openai).toMatchObject({
      configured: true,
      runtimeSupported: true,
      selectable: true,
    })
  })

  it('projects custom providers from the settings envelope', () => {
    const settings = createDefaultSettings()
    settings.customProviders = [
      {
        id: 'custom-test',
        isCustom: true,
        name: 'Custom Test',
        type: ModelProviderType.OpenAI,
      },
    ]
    settings.providers = { 'custom-test': { models: [{ modelId: 'custom-model' }] } }

    expect(projectProviderCatalog(settings, 'mobile').at(-1)).toMatchObject({
      id: 'custom-test',
      configured: true,
      runtimeSupported: true,
      selectable: true,
    })
  })
})
