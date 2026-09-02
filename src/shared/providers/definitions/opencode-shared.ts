import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { fetchRemoteModels } from '../../models/openai-compatible'
import type { ModelInterface } from '../../models/types'
import { createFetchWithProxy } from '../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import type { CreateModelConfig } from '../types'
import CustomClaude from './models/custom-claude'
import CustomGemini from './models/custom-gemini'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'

// OpenCode runs two separate billed gateways off the same console:
//   Zen — pay-as-you-go credits, full catalog, https://opencode.ai/zen/v1
//   Go  — $10/month subscription, open models only, https://opencode.ai/zen/go/v1
// Both authenticate with an API key (no official OAuth) and expose one OpenAI-shaped
// /models catalog while dispatching each model to a different surface. The two
// gateways do NOT agree on routing (e.g. MiniMax is Chat Completions on Zen but
// Anthropic Messages on Go), so each provider brings its own rules.

export type OpenCodeApiStyle = NonNullable<ProviderModelInfo['apiStyle']>

/** Model-id prefixes per surface. Evaluated google → anthropic → responses, else Chat Completions. */
export interface OpenCodeRoutingRules {
  google?: readonly string[]
  anthropic?: readonly string[]
  responses?: readonly string[]
}

export function resolveOpenCodeApiStyle(modelId: string, rules: OpenCodeRoutingRules): OpenCodeApiStyle {
  const normalized = modelId.trim().toLowerCase()
  const matches = (prefixes: readonly string[] | undefined) =>
    Boolean(prefixes?.some((prefix) => normalized.startsWith(prefix)))

  if (matches(rules.google)) {
    return 'google'
  }
  if (matches(rules.anthropic)) {
    return 'anthropic'
  }
  if (matches(rules.responses)) {
    return 'openai-responses'
  }
  return 'openai'
}

type CatalogOptions = { apiHost: string; apiKey: string; useProxy?: boolean }

/**
 * Both gateways publish an OpenAI-shaped `/models` list covering every surface. The
 * Anthropic/Gemini base classes would probe their own vendor-specific catalog endpoint
 * instead and miss the mixed list, so those subclasses fetch this one.
 */
function fetchOpenCodeCatalog(options: CatalogOptions, dependencies: ModelDependencies) {
  return fetchRemoteModels(
    { apiHost: options.apiHost, apiKey: options.apiKey, useProxy: options.useProxy },
    dependencies
  )
}

export interface OpenCodeModelClasses {
  Chat: typeof OpenAI
  Responses: typeof OpenAIResponses
  Claude: typeof CustomClaude
  Gemini: typeof CustomGemini
}

/**
 * Build one gateway's model classes. Called once per provider module (not per request),
 * so the returned classes are stable and `instanceof` still resolves against the bases.
 */
export function defineOpenCodeModelClasses(
  displayName: string,
  stampModels: (models: ProviderModelInfo[]) => ProviderModelInfo[]
): OpenCodeModelClasses {
  class Chat extends OpenAI {
    public name = displayName

    public async listModels(): Promise<ProviderModelInfo[]> {
      return stampModels(await super.listModels())
    }
  }

  class Responses extends OpenAIResponses {
    public name = displayName

    public async listModels(): Promise<ProviderModelInfo[]> {
      return stampModels(await super.listModels())
    }
  }

  class Claude extends CustomClaude {
    public name = displayName

    public async listModels(): Promise<ProviderModelInfo[]> {
      return stampModels(await fetchOpenCodeCatalog(this.options, this.dependencies))
    }
  }

  class Gemini extends CustomGemini {
    public name = displayName

    protected getProvider() {
      // CustomGemini appends `/v1beta` for the public Google endpoint. OpenCode serves
      // Gemini straight off `<host>/models/<id>`, so the host is used as-is.
      return createGoogleGenerativeAI({
        apiKey: this.options.apiKey,
        baseURL: this.options.apiHost.replace(/\/+$/, ''),
        fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
      })
    }

    public async listModels(): Promise<ProviderModelInfo[]> {
      return stampModels(await fetchOpenCodeCatalog(this.options, this.dependencies))
    }
  }

  return { Chat, Responses, Claude, Gemini }
}

export interface OpenCodeGateway {
  classes: OpenCodeModelClasses
  defaultApiHost: string
  defaultModels: ProviderModelInfo[]
  getApiStyle: (modelId: string) => OpenCodeApiStyle
}

export function createOpenCodeModel(config: CreateModelConfig, gateway: OpenCodeGateway): ModelInterface {
  const model: ProviderModelInfo = { ...config.model, apiStyle: gateway.getApiStyle(config.model.modelId) }
  const apiHost = config.formattedApiHost || gateway.defaultApiHost
  const fallbackModels = config.providerSetting.models || gateway.defaultModels
  const shared = {
    apiKey: config.effectiveApiKey,
    apiHost,
    model,
    temperature: config.settings.temperature,
    topP: config.settings.topP,
    maxOutputTokens: config.settings.maxTokens,
    stream: config.settings.stream,
    useProxy: config.providerSetting.useProxy || false,
  }

  switch (model.apiStyle) {
    case 'openai-responses':
      return new gateway.classes.Responses(
        { ...shared, apiPath: '/responses', listModelsFallback: fallbackModels },
        config.dependencies
      )
    case 'anthropic':
      // The gateways accept the Anthropic x-api-key header (not Bearer) on /messages,
      // which createAnthropic({ apiKey }) already sends.
      return new gateway.classes.Claude(shared, config.dependencies)
    case 'google':
      return new gateway.classes.Gemini(shared, config.dependencies)
    default:
      return new gateway.classes.Chat(
        {
          ...shared,
          dalleStyle: 'vivid',
          injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
          listModelsFallback: fallbackModels,
        },
        config.dependencies
      )
  }
}
