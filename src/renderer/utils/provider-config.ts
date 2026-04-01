import { isBuiltinProviderId } from '@shared/providers'
import type { ProviderInfo, ProviderSettings } from '@shared/types'
import { ModelProviderEnum, ModelProviderType } from '@shared/types'
import { z } from 'zod'

export const CUSTOM_PROVIDER_ID_CONFLICT = 'builtin-provider-id-conflict'

const modelInfoSchema = z.object({
  modelId: z.string(),
  nickname: z.string().optional(),
  type: z.enum(['chat', 'embedding', 'rerank']).optional().default('chat'),
  capabilities: z.array(z.enum(['vision', 'reasoning', 'tool_use'])).optional(),
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
})

const BuiltinProviderConfigSchema = z.object({
  id: z.nativeEnum(ModelProviderEnum),
  settings: z.object({
    apiHost: z.string().optional(),
    apiKey: z.string(),
  }),
})

const CustomProviderConfigSchema = z.object({
  isCustom: z.literal(true).catch(true),
  id: z.string(),
  name: z.string(),
  type: z.enum(['openai', 'openai-responses', 'anthropic']),
  iconUrl: z.string().optional(),
  urls: z
    .object({
      website: z.string(),
      getApiKey: z.string().optional(),
      docs: z.string().optional(),
      models: z.string().optional(),
    })
    .optional(),
  settings: z.object({
    apiHost: z.string(),
    apiPath: z.string().optional(),
    apiKey: z.string().optional(),
    models: z.array(modelInfoSchema).optional(),
  }),
})

const ProviderConfigSchema = z.union([BuiltinProviderConfigSchema, CustomProviderConfigSchema])

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

function assertCustomProviderIdIsAvailable(providerId: string): void {
  if (isBuiltinProviderId(providerId)) {
    throw new Error(CUSTOM_PROVIDER_ID_CONFLICT)
  }
}

function parseProviderConfig(json: unknown): ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | undefined {
  if (json && typeof json === 'object' && 'isCustom' in json && json.isCustom === true) {
    const parsedCustom = CustomProviderConfigSchema.parse(json)
    assertCustomProviderIdIsAvailable(parsedCustom.id)
    const providerType =
      parsedCustom.type === 'openai'
        ? ModelProviderType.OpenAI
        : parsedCustom.type === 'openai-responses'
          ? ModelProviderType.OpenAIResponses
          : ModelProviderType.Claude

    const providerInfo: ProviderInfo = {
      id: parsedCustom.id,
      name: parsedCustom.name,
      type: providerType,
      urls: parsedCustom.urls,
      iconUrl: parsedCustom.iconUrl,
      isCustom: true,

      apiHost: parsedCustom.settings.apiHost,
      apiPath: parsedCustom.settings.apiPath,
      apiKey: parsedCustom.settings.apiKey,
      models: parsedCustom.settings.models,
    }

    return providerInfo
  }

  const parsed = ProviderConfigSchema.parse(json)
  if (Object.values(ModelProviderEnum).includes(parsed.id as ModelProviderEnum)) {
    // builtin provider
    const providerSettings: ProviderSettings & { id: ModelProviderEnum } = {
      id: parsed.id as ModelProviderEnum,
      apiHost: parsed.settings.apiHost,
      apiKey: parsed.settings.apiKey,
    }
    return providerSettings
  }

  const parsedCustom = parsed as z.infer<typeof CustomProviderConfigSchema>
  assertCustomProviderIdIsAvailable(parsedCustom.id)
  const providerType =
    parsedCustom.type === 'openai'
      ? ModelProviderType.OpenAI
      : parsedCustom.type === 'openai-responses'
        ? ModelProviderType.OpenAIResponses
        : ModelProviderType.Claude

  return {
    id: parsedCustom.id,
    name: parsedCustom.name,
    type: providerType,
    urls: parsedCustom.urls,
    iconUrl: parsedCustom.iconUrl,
    isCustom: true,
    apiHost: parsedCustom.settings.apiHost,
    apiPath: parsedCustom.settings.apiPath,
    apiKey: parsedCustom.settings.apiKey,
    models: parsedCustom.settings.models,
  }
}
export function parseProviderFromJson(
  text: string
): ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | undefined {
  try {
    const json = JSON.parse(text)
    return parseProviderConfig(json)
  } catch (err) {
    // In test environment, don't log expected errors
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to parse provider config:', err)
    }
    return undefined
  }
}

export function validateProviderConfig(config: unknown): ProviderConfig | undefined {
  try {
    if (config && typeof config === 'object' && 'isCustom' in config && config.isCustom === true) {
      const parsed = CustomProviderConfigSchema.parse(config)
      assertCustomProviderIdIsAvailable(parsed.id)
      return parsed
    }
    const parsed = ProviderConfigSchema.parse(config)
    if (!Object.values(ModelProviderEnum).includes(parsed.id as ModelProviderEnum)) {
      assertCustomProviderIdIsAvailable(parsed.id)
    }
    return parsed
  } catch (err) {
    // In test environment, don't log expected errors
    if (process.env.NODE_ENV !== 'test') {
      console.error('Provider config validation failed:', err)
    }
    return undefined
  }
}
