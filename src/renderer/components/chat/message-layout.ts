import type { Message } from '@shared/types'
import { cn } from '@/lib/utils'

export type MessageLayout = 'classic' | 'bubble'

/** Widest an assistant reply may grow, in either layout. */
export const ASSISTANT_CONTENT_MAX_WIDTH = 840

export type ConversationRowLayout = {
  avatarSize: number
  avatarGap: number
  /** Space kept clear on the side opposite the speaker: right of assistant replies, left of user bubbles. */
  farSideSpace: number
  userBubbleMaxWidth: string
  /** Loader drawn around the avatar while a reply streams. */
  generatingLoaderSize: number
  /** Top offset that centers the assistant name row's line box on the avatar. */
  nameRowOffset: number
}

const NAME_ROW_LINE_HEIGHT = 20

export function getConversationRowLayout(isSmallScreen: boolean, showAvatar: boolean): ConversationRowLayout {
  const avatarSize = isSmallScreen ? 24 : 28
  return {
    avatarSize,
    avatarGap: isSmallScreen ? 8 : 10,
    farSideSpace: showAvatar ? (isSmallScreen ? 24 : 64) : isSmallScreen ? 44 : 128,
    userBubbleMaxWidth: isSmallScreen ? '80%' : 'min(640px, 72%)',
    generatingLoaderSize: avatarSize + 4,
    nameRowOffset: showAvatar ? (avatarSize - NAME_ROW_LINE_HEIGHT) / 2 : 0,
  }
}

const BUBBLE_PADDING = { small: 'px-3.5 py-[9px]', wide: 'px-4 py-2.5' } as const

/**
 * Surface classes for user and assistant message content. The two layouts differ only in the assistant reply:
 * classic lays it flat on the page, bubble wraps it in a secondary-colored bubble.
 */
export function getConversationContentClassName({
  layout,
  role,
  isSmallScreen,
  errorOnly,
}: {
  layout: MessageLayout
  role: 'user' | 'assistant'
  isSmallScreen: boolean
  errorOnly: boolean
}): string {
  const padding = isSmallScreen ? BUBBLE_PADDING.small : BUBBLE_PADDING.wide
  if (role === 'user') {
    return cn(
      'inline-block max-w-full min-w-0 rounded-2xl rounded-tr-[4px] text-white',
      'bg-[var(--mantine-color-chatbox-brand-filled)]',
      padding
    )
  }
  if (layout === 'classic' || errorOnly) return 'max-w-full min-w-0'
  return cn('inline-block max-w-full min-w-0 rounded-2xl rounded-tl-[4px] bg-chatbox-background-secondary', padding)
}

export function isErrorOnlyMessage(message: Message): boolean {
  return Boolean(
    message.role === 'assistant' &&
      message.error &&
      !message.reasoningContent?.trim() &&
      !message.status?.some((status) => status.type === 'preparing_tool_call') &&
      !message.contentParts?.some((part) => {
        if (part.type === 'reasoning') return !part.protocolOnly && part.text.trim().length > 0
        if (part.type === 'text' || part.type === 'info') return part.text.trim().length > 0
        return true
      })
  )
}
