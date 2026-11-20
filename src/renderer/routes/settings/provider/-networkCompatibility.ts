import type { PlatformType } from '@shared/platform'
import { ModelProviderEnum } from '@shared/types'

/** Built-in providers whose endpoints reject browser CORS, so Web users need the relay switch. */
const WEB_NETWORK_COMPATIBILITY_PROVIDERS = new Set<string>([
  ModelProviderEnum.OpenCodeGo,
  ModelProviderEnum.OpenCodeZen,
  ModelProviderEnum.GLM,
  ModelProviderEnum.ZhipuGLMCodingPlan,
])

/**
 * Providers whose endpoint does not send CORS headers at all. In the Android
 * WebView these have to go through the native HTTP bridge, so the switch is
 * exposed on mobile as well (the Kimi Code gateway is one of them).
 */
const NO_CORS_HEADER_PROVIDERS = new Set<string>([ModelProviderEnum.KimiCode])

export function showsNetworkCompatibility(provider: { id: string; isCustom?: boolean }, platformType: PlatformType) {
  return (
    !!provider.isCustom ||
    provider.id === ModelProviderEnum.Ollama ||
    NO_CORS_HEADER_PROVIDERS.has(provider.id) ||
    (platformType === 'web' && WEB_NETWORK_COMPATIBILITY_PROVIDERS.has(provider.id))
  )
}
