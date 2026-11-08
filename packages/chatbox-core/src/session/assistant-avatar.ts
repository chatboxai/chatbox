import {
  PROVIDER_AVATAR_ICON_NAMES,
  PROVIDER_AVATAR_ICONS,
  type ProviderAvatarIcon,
} from './provider-avatars.generated'
import { ModelProviderEnum } from '@shared/types/provider'

export type { ProviderAvatarIcon }

/** What a chat message's assistant avatar shows, in priority order. */
export type AssistantAvatarSource =
  /** Session/copilot avatar or the global default assistant avatar, stored in blob storage. */
  | { type: 'storage'; key: string }
  /** Session/copilot picture URL or a custom provider's icon URL, cropped round. */
  | { type: 'image'; url: string }
  | { type: 'provider'; icon: ProviderAvatarIcon }
  | { type: 'chatbox-ai' }
  | { type: 'default' }

export interface AssistantAvatarInput {
  assistantAvatarKey?: string
  picUrl?: string
  defaultAssistantAvatarKey?: string
  /** The provider that generated the message (`message.aiProvider`). */
  aiProvider?: string
  customProviders?: readonly { id: string; iconUrl?: string }[]
}

export function getProviderAvatarIcon(providerId: string): ProviderAvatarIcon | undefined {
  const iconName = PROVIDER_AVATAR_ICON_NAMES[providerId]
  return iconName ? PROVIDER_AVATAR_ICONS[iconName] : undefined
}

/**
 * Session/copilot avatar > global default assistant avatar > the message provider's round icon > the default avatar.
 * A custom provider shows its icon URL when set; providers without an icon fall back to the default avatar.
 */
export function resolveAssistantAvatar(input: AssistantAvatarInput): AssistantAvatarSource {
  if (input.assistantAvatarKey) return { type: 'storage', key: input.assistantAvatarKey }
  if (input.picUrl) return { type: 'image', url: input.picUrl }
  if (input.defaultAssistantAvatarKey) return { type: 'storage', key: input.defaultAssistantAvatarKey }

  const providerId = input.aiProvider
  if (!providerId) return { type: 'default' }
  if (providerId === ModelProviderEnum.ChatboxAI) return { type: 'chatbox-ai' }
  const icon = getProviderAvatarIcon(providerId)
  if (icon) return { type: 'provider', icon }
  const iconUrl = input.customProviders?.find((provider) => provider.id === providerId)?.iconUrl
  return iconUrl ? { type: 'image', url: iconUrl } : { type: 'default' }
}

const LIGHT_THEME_OUTLINE = 'rgba(0,0,0,0.05)'
const DARK_THEME_OUTLINE = 'rgba(255,255,255,0.1)'

function getRelativeLuminance(color: string): number | undefined {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (!hex) return undefined
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(full.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * A 1px inner outline that keeps a near-white avatar visible in the light theme and a near-black one in the dark
 * theme, following lobehub's `getAvatarShadow`. Returns the outline color, or undefined when none is needed.
 */
export function getProviderAvatarOutline(background: string, colorScheme: 'light' | 'dark'): string | undefined {
  const luminance = getRelativeLuminance(background)
  if (luminance === undefined) return undefined
  if (colorScheme === 'light' && luminance > 0.85) return LIGHT_THEME_OUTLINE
  if (colorScheme === 'dark' && luminance < 0.02) return DARK_THEME_OUTLINE
  return undefined
}

export function getProviderAvatarDataUri(icon: ProviderAvatarIcon): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}`
}
