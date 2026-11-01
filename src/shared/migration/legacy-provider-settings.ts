import { uniq, uniqBy } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import { SystemProviders } from '../defaults'
import { ModelProviderEnum, ModelProviderType, type Settings } from '../types'

/**
 * Pure data-shape transforms shared between the renderer migration chain
 * (`migrate_9_to_10`) and the native legacy-storage importer.
 *
 * Pre-v10 installs stored every provider's credentials as flat top-level keys
 * on `settings` (`openaiKey`, `claudeApiKey`, `aiProvider`, `model`, …) with no
 * `providers` map. These helpers normalize that legacy shape into the current
 * `Settings['providers']` / `customProviders` structure WITHOUT touching any
 * platform/storage APIs, so both web and native can reuse the exact same logic.
 */

interface LegacyCustomProvider {
  name?: string
  key?: string
  host?: string
  path?: string
  useProxy?: boolean
  modelOptions?: string[]
  model?: string
}

/** Loose view of a pre-v10 flat `settings` object. */
export interface LegacyFlatSettings {
  aiProvider?: string
  // openai
  openaiKey?: string
  apiHost?: string
  model?: string
  openaiCustomModel?: string
  openaiCustomModelOptions?: string[]
  // azure
  azureEndpoint?: string
  azureDeploymentNameOptions?: string[]
  azureDalleDeploymentName?: string
  azureApikey?: string
  azureApiVersion?: string
  // chatglm
  chatglmApiKey?: string
  // claude
  claudeApiKey?: string
  claudeApiHost?: string
  // gemini
  geminiAPIKey?: string
  geminiAPIHost?: string
  // ollama
  ollamaHost?: string
  // groq
  groqAPIKey?: string
  // deepseek
  deepseekAPIKey?: string
  // siliconflow
  siliconCloudKey?: string
  // lmstudio
  lmStudioHost?: string
  // perplexity
  perplexityApiKey?: string
  // xai
  xAIKey?: string
  customProviders?: LegacyCustomProvider[]
  // allow dynamic access to the provider-specific model keys below
  [key: string]: unknown
}

/**
 * Maps a provider id to the flat `settings` key that held its selected model id
 * before v10 (e.g. Claude → `claudeModel`). Used to recover the active model
 * from legacy flat settings.
 */
export const LEGACY_PROVIDER_MODEL_KEYS: Record<string, string> = {
  [ModelProviderEnum.ChatboxAI]: 'chatboxAIModel',
  [ModelProviderEnum.OpenAI]: 'model',
  [ModelProviderEnum.Claude]: 'claudeModel',
  [ModelProviderEnum.Gemini]: 'geminiModel',
  [ModelProviderEnum.Ollama]: 'ollamaModel',
  [ModelProviderEnum.LMStudio]: 'lmStudioModel',
  [ModelProviderEnum.DeepSeek]: 'deepseekModel',
  [ModelProviderEnum.SiliconFlow]: 'siliconCloudModel',
  [ModelProviderEnum.Azure]: 'azureDeploymentName',
  [ModelProviderEnum.XAI]: 'xAIModel',
  [ModelProviderEnum.Perplexity]: 'perplexityModel',
  [ModelProviderEnum.Groq]: 'groqModel',
  [ModelProviderEnum.GLM]: 'chatglmModel',
  [ModelProviderEnum.Custom]: 'model',
}

export interface MigratedProviderSettings {
  providers: NonNullable<Settings['providers']>
  customProviders: NonNullable<Settings['customProviders']>
}

/**
 * Normalize a pre-v10 flat `settings` object into the current `providers` map +
 * `customProviders` list. Pure: no I/O, no platform deps. Faithfully ported from
 * the renderer `migrate_9_to_10` so the two stay in lockstep.
 */
export function migrateLegacyProviderSettings(oldSettings: LegacyFlatSettings): MigratedProviderSettings {
  const {
    openaiKey,
    apiHost,
    openaiCustomModel,
    openaiCustomModelOptions,
    azureEndpoint,
    azureDeploymentNameOptions,
    azureDalleDeploymentName,
    azureApikey,
    azureApiVersion,
    chatglmApiKey,
    claudeApiKey,
    claudeApiHost,
    geminiAPIKey,
    geminiAPIHost,
    ollamaHost,
    groqAPIKey,
    deepseekAPIKey,
    siliconCloudKey,
    lmStudioHost,
    perplexityApiKey,
    xAIKey,
    customProviders: oldCustomProviders,
  } = oldSettings

  const providers: NonNullable<Settings['providers']> = {}
  const customProviders: NonNullable<Settings['customProviders']> = []

  try {
    if (openaiKey || apiHost) {
      providers[ModelProviderEnum.OpenAI] = {
        apiHost,
        apiKey: openaiKey,
        // 将openaiCustomModelOptions和openaiCustomModel迁移过来
        models:
          openaiCustomModel || openaiCustomModelOptions
            ? uniqBy(
                [
                  ...(SystemProviders().find((p) => p.id === ModelProviderEnum.OpenAI)?.defaultSettings?.models || []),
                  ...(openaiCustomModel ? [{ modelId: openaiCustomModel }] : []),
                  ...(openaiCustomModelOptions || []).map((o: string) => ({
                    modelId: o,
                  })),
                ],
                'modelId'
              )
            : undefined,
      }
    }
  } catch {
    // ignore malformed openai legacy settings
  }

  if (claudeApiKey || claudeApiHost) {
    providers[ModelProviderEnum.Claude] = {
      apiKey: claudeApiKey,
      apiHost: claudeApiHost,
    }
  }
  if (geminiAPIKey || geminiAPIHost) {
    providers[ModelProviderEnum.Gemini] = {
      apiKey: geminiAPIKey,
      apiHost: geminiAPIHost,
    }
  }
  if (deepseekAPIKey) {
    providers[ModelProviderEnum.DeepSeek] = {
      apiKey: deepseekAPIKey,
    }
  }
  if (siliconCloudKey) {
    providers[ModelProviderEnum.SiliconFlow] = {
      apiKey: siliconCloudKey,
    }
  }
  if (azureEndpoint || azureDeploymentNameOptions || azureDalleDeploymentName || azureApikey || azureApiVersion) {
    providers[ModelProviderEnum.Azure] = {
      apiKey: azureApikey,
      endpoint: azureEndpoint,
      dalleDeploymentName: azureDalleDeploymentName,
      apiVersion: azureApiVersion,
      models: azureDeploymentNameOptions?.map((op: string) => ({
        modelId: op,
      })),
    }
  }
  if (xAIKey) {
    providers[ModelProviderEnum.XAI] = {
      apiKey: xAIKey,
    }
  }
  if (ollamaHost) {
    providers[ModelProviderEnum.Ollama] = {
      apiHost: ollamaHost,
    }
  }
  if (lmStudioHost) {
    providers[ModelProviderEnum.LMStudio] = {
      apiHost: lmStudioHost,
    }
  }
  if (perplexityApiKey) {
    providers[ModelProviderEnum.Perplexity] = {
      apiKey: perplexityApiKey,
    }
  }
  if (groqAPIKey) {
    providers[ModelProviderEnum.Groq] = {
      apiKey: groqAPIKey,
    }
  }
  if (chatglmApiKey) {
    providers[ModelProviderEnum.GLM] = {
      apiKey: chatglmApiKey,
    }
  }

  try {
    if (oldCustomProviders) {
      oldCustomProviders.forEach((cp) => {
        const pid = `custom-provider-${uuidv4()}`
        customProviders.push({
          id: pid,
          name: cp.name ?? '',
          isCustom: true,
          type: ModelProviderType.OpenAI,
        })
        providers[pid] = {
          apiKey: cp.key,
          apiHost: cp.host,
          apiPath: cp.path,
          useProxy: cp.useProxy,
          models: uniq([...(cp.modelOptions || []), cp.model || ''])
            .filter((op) => !!op)
            .map((op) => ({
              modelId: op,
            })),
        }
      })
    }
  } catch {
    // ignore malformed custom provider legacy settings
  }

  return { providers, customProviders }
}
