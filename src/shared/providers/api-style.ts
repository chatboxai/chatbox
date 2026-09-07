import { type ModelProvider, ModelProviderEnum, ModelProviderType, type ProviderModelInfo } from '../types'
import { applyGitHubCopilotModelMetadata } from './definitions/github-copilot-routing'

/**
 * Maps a provider's type (its API family) to the model API style. ChatboxAI, custom
 * providers, and built-in proxy providers (e.g. github-copilot) carry no reasoning
 * semantics in their provider id, so reasoning-control support is judged by API style
 * (derived from the provider type) + model id.
 *
 * Single source of truth shared by:
 *  - getModel() (request side, stamps `model.apiStyle` when missing)
 *  - useReasoningControlState (UI side, fills the reasoning control's model info)
 * so both paths resolve the same effective provider.
 */
export const API_STYLE_BY_PROVIDER_TYPE: Partial<Record<ModelProviderType, ProviderModelInfo['apiStyle']>> = {
  [ModelProviderType.Claude]: 'anthropic',
  [ModelProviderType.Gemini]: 'google',
  [ModelProviderType.OpenAIResponses]: 'openai-responses',
  [ModelProviderType.OpenAI]: 'openai',
}

export function apiStyleFromProviderType(
  type: ModelProviderType | string | undefined
): ProviderModelInfo['apiStyle'] | undefined {
  return type ? API_STYLE_BY_PROVIDER_TYPE[type as ModelProviderType] : undefined
}

/**
 * Resolve the API style used for reasoning controls and request routing.
 * Proxy providers such as GitHub Copilot overwrite the provider-type fallback
 * from the model id so catalog/stored records match the wire protocol.
 */
export function withResolvedModelApiStyle(
  model: ProviderModelInfo,
  options: { providerId?: string; providerType?: string }
): ProviderModelInfo {
  if (options.providerId === 'github-copilot') {
    return applyGitHubCopilotModelMetadata(model)
  }
  if (model.apiStyle) return model
  const apiStyle = apiStyleFromProviderType(options.providerType)
  return apiStyle ? { ...model, apiStyle } : model
}

/**
 * Bedrock shares `apiStyle === 'anthropic'` with direct Anthropic routes (same
 * model family, same reasoning-control semantics) but speaks the Converse wire
 * protocol: reasoning replay metadata lives under the `bedrock` provider
 * namespace instead of `anthropic`, and empty text blocks between thinking
 * blocks must be preserved rather than dropped. Anything that decides per wire
 * protocol (reasoning history replay, block-structure handling) must branch on
 * this predicate, not on `apiStyle` alone.
 */
export function usesBedrockConverseProtocol(provider: ModelProvider | undefined): boolean {
  return provider === ModelProviderEnum.Bedrock
}
