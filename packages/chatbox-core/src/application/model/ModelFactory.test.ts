import { describe, expect, it, vi } from 'vitest'
import type { ModelInterface } from '../../models/types'
import type { SettingsRepositoryPort } from '../../ports'
import type { Config, SessionSettings, Settings } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import { ModelFactory } from './ModelFactory'

function createSettingsRepository(settings: Settings): SettingsRepositoryPort {
  return {
    hydrate: () => Promise.resolve(settings),
    getSettings: () => settings,
    updateSettings: () => undefined,
    subscribe: () => () => undefined,
  }
}

describe('ModelFactory', () => {
  it('assembles a model from injected settings, config and host dependencies', async () => {
    const globalSettings = { language: 'en' } as Settings
    const sessionSettings = { provider: 'openai', modelId: 'gpt-4.1' } as SessionSettings
    const config: Config = { uuid: 'model-factory-test' }
    const dependencies = { platformType: 'mobile' } as ModelDependencies
    const model = { name: 'Test model', modelId: 'gpt-4.1' } as ModelInterface
    const loadConfig = vi.fn(() => Promise.resolve(config))
    const createDependencies = vi.fn(() => Promise.resolve(dependencies))
    const resolveModel = vi.fn(() => model)
    const factory = new ModelFactory({
      settingsRepository: createSettingsRepository(globalSettings),
      loadConfig,
      createDependencies,
      resolveModel,
    })

    await expect(factory.createModel(sessionSettings)).resolves.toBe(model)
    expect(loadConfig).toHaveBeenCalledOnce()
    expect(createDependencies).toHaveBeenCalledOnce()
    expect(resolveModel).toHaveBeenCalledWith(sessionSettings, globalSettings, config, dependencies)
  })

  it('reuses explicitly supplied dependencies without rebuilding them', async () => {
    const globalSettings = {} as Settings
    const suppliedDependencies = { platformType: 'ios' } as unknown as ModelDependencies
    const createDependencies = vi.fn(() => Promise.reject(new Error('must not run')))
    const resolveModel = vi.fn(
      () =>
        ({
          name: 'Injected model',
          modelId: 'injected',
        }) as ModelInterface
    )
    const factory = new ModelFactory({
      settingsRepository: createSettingsRepository(globalSettings),
      loadConfig: () => Promise.resolve({ uuid: 'injected-dependencies' }),
      createDependencies,
      resolveModel,
    })

    await factory.createModel({ provider: 'openai', modelId: 'gpt-4.1' }, suppliedDependencies)

    expect(createDependencies).not.toHaveBeenCalled()
    expect(resolveModel).toHaveBeenCalledWith(
      expect.any(Object),
      globalSettings,
      { uuid: 'injected-dependencies' },
      suppliedDependencies
    )
  })
})
