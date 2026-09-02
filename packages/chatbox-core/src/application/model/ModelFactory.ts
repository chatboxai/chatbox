import type { ModelInterface } from '../../models/types'
import type { ModelFactoryPort, SettingsRepositoryPort } from '../../ports'
import type { Config, SessionSettings, Settings } from '../../types'
import type { ModelDependencies } from '../../types/adapters'

export type ModelResolver = (
  settings: SessionSettings,
  globalSettings: Settings,
  config: Config,
  dependencies: ModelDependencies
) => ModelInterface

export interface ModelFactoryOptions {
  settingsRepository: SettingsRepositoryPort
  loadConfig(): Promise<Config>
  createDependencies(): Promise<ModelDependencies>
  resolveModel: ModelResolver
}

/**
 * Host-neutral model assembly service.
 *
 * Provider resolution remains synchronous once the host has supplied global
 * settings, app config and request/storage/OAuth dependencies.
 */
export class ModelFactory implements ModelFactoryPort {
  constructor(private readonly options: ModelFactoryOptions) {}

  async createModel(settings: SessionSettings, dependencies?: ModelDependencies): Promise<ModelInterface> {
    const globalSettings = this.options.settingsRepository.getSettings()
    const config = await this.options.loadConfig()
    const modelDependencies = dependencies ?? (await this.options.createDependencies())
    return this.options.resolveModel(settings, globalSettings, config, modelDependencies)
  }
}
