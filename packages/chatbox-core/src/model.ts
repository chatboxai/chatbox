/** React Native-safe model/provider entrypoint with explicit registry initialization. */
import '@shared/providers/builtin-registration'

export type { ModelInterface } from '@shared/models/types'
export {
  getAllProviders,
  getBuiltinProviderIds,
  getModel,
  getProviderDefinition,
  getProviderSettings,
  getSystemProviders,
  hasProvider,
  isBuiltinProviderId,
} from '@shared/providers'
export type { Config, ProviderModelInfo, ProviderSettings, SessionSettings, Settings } from '@shared/types'
export type { ModelDependencies, OAuthAdapter, RequestAdapter, StorageAdapter } from '@shared/types/adapters'
export { ModelProviderEnum, ModelProviderType } from '@shared/types/provider'
export type { ModelFactoryOptions, ModelResolver } from './application/model'
export { ModelFactory } from './application/model'
