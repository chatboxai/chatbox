import { ModelProviderEnum, type SessionSettings, type Settings } from '@shared/types'
import { shouldPauseOnToolCallLimit } from '@shared/utils/tool-call-limit-pause'

/**
 * Chat parameters a conversation inherits from the global "new chat defaults" while its own value
 * is unset. A set value overrides the global one until it is restored.
 */
export const INHERITED_CHAT_SETTING_KEYS = ['maxContextMessageCount', 'temperature', 'topP', 'stream'] as const

/** Every parameter the conversation settings panel can override. */
export const SESSION_PARAMETER_KEYS = [
  'maxContextMessageCount',
  'temperature',
  'topP',
  'maxTokens',
  'claudePromptCacheTTL',
  'stream',
  'pauseOnToolCallLimit',
] as const

export type SessionParameterKey = (typeof SESSION_PARAMETER_KEYS)[number]

export type GlobalChatDefaults = Pick<Settings, (typeof INHERITED_CHAT_SETTING_KEYS)[number] | 'pauseOnToolCallLimit'>

/**
 * Global defaults the session inherits. Chatbox AI always streams, so its sessions do not take
 * the global streaming switch.
 */
export function globalChatDefaults(
  settings: GlobalChatDefaults,
  provider: string | undefined
): Pick<SessionSettings, (typeof INHERITED_CHAT_SETTING_KEYS)[number]> {
  const defaults: Pick<SessionSettings, (typeof INHERITED_CHAT_SETTING_KEYS)[number]> = {}
  for (const key of INHERITED_CHAT_SETTING_KEYS) {
    if (key === 'stream' && provider === ModelProviderEnum.ChatboxAI) continue
    if (settings[key] !== undefined) Object.assign(defaults, { [key]: settings[key] })
  }
  return defaults
}

/** Session settings without keys that are present but unset, so they do not hide inherited values. */
export function definedSessionSettings(settings: SessionSettings | undefined): SessionSettings {
  return Object.fromEntries(Object.entries(settings ?? {}).filter(([, value]) => value !== undefined))
}

/** Chat session settings with unset parameters filled from the global defaults. */
export function inheritChatSettings(
  settings: SessionSettings | undefined,
  global: GlobalChatDefaults,
  defaultProvider: string
): SessionSettings {
  return {
    ...globalChatDefaults(global, settings?.provider ?? defaultProvider),
    ...definedSessionSettings(settings),
  }
}

/** The value a parameter takes when the session does not set it. */
export function inheritedParameterValue(
  key: SessionParameterKey,
  global: GlobalChatDefaults,
  settings?: SessionSettings
) {
  switch (key) {
    case 'maxContextMessageCount':
      return global.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER
    case 'stream':
      return global.stream ?? true
    case 'pauseOnToolCallLimit':
      // Full Access chats run unattended unless they choose otherwise.
      return shouldPauseOnToolCallLimit({ ...settings, pauseOnToolCallLimit: undefined }, global)
    case 'temperature':
    case 'topP':
      return global[key]
    default:
      return undefined
  }
}

/** Parameters whose effective value differs from what the session would inherit. */
export function countSessionDifferences(
  settings: SessionSettings | undefined,
  keys: readonly SessionParameterKey[],
  global: GlobalChatDefaults
) {
  return keys.filter(
    (key) => settings?.[key] !== undefined && settings[key] !== inheritedParameterValue(key, global, settings)
  ).length
}

export function isSessionParameterOverridden(settings: SessionSettings | undefined, key: SessionParameterKey) {
  return settings?.[key] !== undefined
}

/** Patch that returns the given parameters to their inherited values; other settings are untouched. */
export function restoreSessionParameters(keys: readonly SessionParameterKey[]): Partial<SessionSettings> {
  return Object.fromEntries(keys.map((key) => [key, undefined]))
}

/** Session parameters shown for this model; differences count toward the summary. */
export function visibleSessionParameterKeys(settings: SessionSettings | undefined): SessionParameterKey[] {
  return [
    'maxContextMessageCount',
    'temperature',
    'topP',
    'maxTokens',
    ...(settings?.provider === ModelProviderEnum.Claude ? (['claudePromptCacheTTL'] as const) : []),
    ...(settings?.provider !== ModelProviderEnum.ChatboxAI ? (['stream'] as const) : []),
    'pauseOnToolCallLimit',
  ]
}
