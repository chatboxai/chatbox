import { v5 as uuidv5 } from 'uuid'
import type { ModelInterface } from '../models/types'
import { getChatboxAPIOrigin } from '../request/chatbox-api-origin'
import { ModelProviderEnum } from '../types'
import type { CreateModelConfig } from './types'

/** Bind opaque ciphertext to the configuration that produced it, without storing credentials. */
export function bindReasoningReplaySource(model: ModelInterface, config: CreateModelConfig): ModelInterface {
  if (model.apiStyle !== 'openai-responses') return model
  const provider = config.settings.provider
  const isChatbox = provider === ModelProviderEnum.ChatboxAI
  const oauthAccountId = config.providerSetting.oauth?.extra?.accountId
  // OAuth access tokens refresh routinely while ciphertext stays bound to the account.
  const credential = isChatbox
    ? config.globalSettings.licenseKey
    : config.providerSetting.activeAuthMode === 'oauth' && typeof oauthAccountId === 'string' && oauthAccountId
      ? oauthAccountId
      : config.effectiveApiKey
  if (!provider || !credential) return model
  // A deterministic identifier for equality checks, not an authentication credential.
  // API key rotation conservatively starts a new replay scope.
  model.reasoningReplaySource = uuidv5(
    JSON.stringify([
      provider,
      model.modelId,
      isChatbox ? getChatboxAPIOrigin() : config.formattedApiHost,
      config.formattedApiPath,
      config.providerSetting.activeAuthMode || 'apikey',
      credential,
      config.providerSetting.oauth?.extra,
    ]),
    uuidv5.URL
  )
  return model
}
