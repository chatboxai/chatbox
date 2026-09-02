import { ModelFactory } from '@chatbox/core/application/model'
import { getModel } from '@shared/models'
import platform from '@/platform'
import { settingsService } from '@/settings-runtime'
import { createModelDependencies } from './RendererModelDependencies'

/** Current Renderer composition of the host-neutral model factory. */
export const currentModelFactory = new ModelFactory({
  settingsRepository: settingsService,
  loadConfig: () => platform.getConfig(),
  createDependencies: () => createModelDependencies(),
  resolveModel: getModel,
})
