import type { ModelInterface } from '@shared/models/types'
import type { SessionSettings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { currentModelFactory } from './CurrentModelFactory'

export { currentModelFactory } from './CurrentModelFactory'
export {
  type CreateModelDependenciesOptions,
  createModelDependencies,
  type ModelDependencyPlatformInfo,
} from './RendererModelDependencies'
export { type ModelBlobStorage, RendererModelStorageAdapter } from './RendererModelStorageAdapter'
export { type OAuthIpcInvoker, RendererOAuthAdapter } from './RendererOAuthAdapter'
export { type RendererApiRequestClient, RendererRequestAdapter } from './RendererRequestAdapter'

/**
 * Compatibility facade retained for existing Renderer call sites.
 */
export function createModel(settings: SessionSettings, dependencies?: ModelDependencies): Promise<ModelInterface> {
  return currentModelFactory.createModel(settings, dependencies)
}
