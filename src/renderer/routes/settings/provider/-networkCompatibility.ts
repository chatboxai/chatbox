import type { PlatformType } from '@shared/platform'
import { ModelProviderEnum } from '@shared/types'

/** Built-in providers whose endpoints reject browser CORS, so Web users need the relay switch. */
const WEB_NETWORK_COMPATIBILITY_PROVIDERS = new Set<string>([
  ModelProviderEnum.OpenCodeGo,
  ModelProviderEnum.OpenCodeZen,
  ModelProviderEnum.GLM,
  ModelProviderEnum.ZhipuGLMCodingPlan,
])

export function showsNetworkCompatibility(provider: { id: string; isCustom?: boolean }, platformType: PlatformType) {
  return (
    !!provider.isCustom ||
    provider.id === ModelProviderEnum.Ollama ||
    (platformType === 'web' && WEB_NETWORK_COMPATIBILITY_PROVIDERS.has(provider.id))
  )
}
