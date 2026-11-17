import { type ChatboxAILicenseDetail, ModelProviderEnum, type SessionHeader } from '@shared/types'
import { isChatboxAILowTierPlan } from './licensePlan'

export type ChatboxLicenseDefaultModelId = NonNullable<ChatboxAILicenseDetail['defaultModel']>

type ChatboxLicenseDetailForDefaultModel = Pick<ChatboxAILicenseDetail, 'defaultModel' | 'type' | 'name' | 'plan'>

export type ChatboxDefaultModelSettings = {
  licenseKey?: string
  hasExpiredLicense?: boolean
  licenseDetail?: ChatboxLicenseDetailForDefaultModel
  licensePlanName?: string
}

export type DefaultChatModelSelection = {
  provider: string
  modelId: string
}

const CHATBOX_AI_35_MODEL_ID: ChatboxLicenseDefaultModelId = 'chatboxai-3.5'
const CHATBOX_AI_4_MODEL_ID: ChatboxLicenseDefaultModelId = 'chatboxai-4'

function isChatboxLicenseDefaultModelId(value: string | undefined): value is ChatboxLicenseDefaultModelId {
  return value === CHATBOX_AI_35_MODEL_ID || value === CHATBOX_AI_4_MODEL_ID
}

export function resolveChatboxLicenseDefaultModel(
  settings: ChatboxDefaultModelSettings
): DefaultChatModelSelection | undefined {
  if (!settings.licenseKey || settings.hasExpiredLicense) {
    return undefined
  }

  const licenseModel = settings.licenseDetail?.defaultModel ?? settings.licenseDetail?.type
  if (isChatboxLicenseDefaultModelId(licenseModel)) {
    return {
      provider: ModelProviderEnum.ChatboxAI,
      modelId: licenseModel,
    }
  }

  const modelId = isChatboxAILowTierPlan(settings.licenseDetail, settings.licensePlanName)
    ? CHATBOX_AI_35_MODEL_ID
    : CHATBOX_AI_4_MODEL_ID

  return {
    provider: ModelProviderEnum.ChatboxAI,
    modelId,
  }
}

export function applyChatboxLicenseDefaultModelToSession<T extends Pick<SessionHeader, 'type' | 'settings'>>(
  session: T,
  settings: ChatboxDefaultModelSettings
): T {
  if (session.type !== 'chat' || (session.settings?.provider && session.settings?.modelId)) {
    return session
  }

  const defaultModel = resolveChatboxLicenseDefaultModel(settings)
  if (!defaultModel) {
    return session
  }

  return {
    ...session,
    settings: {
      ...(session.settings || {}),
      ...defaultModel,
    },
  }
}
