import type { Message } from '@shared/types'
import { cn } from '@/lib/utils'

export type MessageLayout = 'classic' | 'bubble'

/** Classic keeps every avatar on the left; bubble puts the user's bubble and avatar on the right. */
export function isUserMessageOnRight(layout: MessageLayout): boolean {
  return layout === 'bubble'
}

/** Widest an assistant reply may grow in the standard-width column, in either layout. */
export const ASSISTANT_CONTENT_MAX_WIDTH = 840

export type ConversationRowLayout = {
  avatarSize: number
  avatarGap: number
  /** Space kept clear beside user bubbles on the side away from the user avatar; none on a small screen. */
  userFarSideSpace: number
  /** Space kept clear right of assistant replies; none on a small screen. */
  assistantFarSideSpace: number
  /**
   * On a small screen the assistant avatar sits above the reply, beside its name row, so the reply takes the full
   * width of the column. Elsewhere the avatar sits beside the reply.
   */
  assistantAvatarAbove: boolean
  /** On a small screen the bubble leaves a narrow strip of the column clear, matching the room the avatar takes. */
  userBubbleMaxWidth: string
  /** The reply spans the full-width content column instead of stopping at ASSISTANT_CONTENT_MAX_WIDTH. */
  spansColumn: boolean
  /** Widest the assistant reply may grow; unset when the reply spans the content column. */
  assistantContentMaxWidth?: number
  /** Loader drawn around the avatar while a reply streams. */
  generatingLoaderSize: number
  /** Top offset that centers the assistant name row's line box on the avatar. */
  nameRowOffset: number
}

const NAME_ROW_LINE_HEIGHT = 20

/**
 * Row metrics for one conversation message. `wideColumn` is the full-width content column on a wide screen: replies
 * span the column and user bubbles sit at its edge, so neither side keeps far-side space. A small screen keeps no
 * far-side space either, with or without avatars.
 */
export function getConversationRowLayout(
  isSmallScreen: boolean,
  showAvatar: boolean,
  wideColumn = false
): ConversationRowLayout {
  const avatarSize = isSmallScreen ? 24 : 28
  const spansColumn = wideColumn && !isSmallScreen
  const farSideSpace = spansColumn || isSmallScreen ? 0 : showAvatar ? 64 : 128
  return {
    avatarSize,
    avatarGap: isSmallScreen ? 8 : 10,
    userFarSideSpace: farSideSpace,
    assistantFarSideSpace: farSideSpace,
    assistantAvatarAbove: isSmallScreen && showAvatar,
    userBubbleMaxWidth: isSmallScreen ? (showAvatar ? 'calc(100% - 3rem)' : '95%') : 'min(640px, 72%)',
    spansColumn,
    assistantContentMaxWidth: spansColumn ? undefined : ASSISTANT_CONTENT_MAX_WIDTH,
    generatingLoaderSize: avatarSize + 4,
    nameRowOffset: showAvatar ? (avatarSize - NAME_ROW_LINE_HEIGHT) / 2 : 0,
  }
}

const BUBBLE_PADDING = { small: 'px-3.5 py-[9px]', wide: 'px-4 py-2.5' } as const

/**
 * Surface classes for user and assistant message content. Both layouts draw the user bubble with its tail corner
 * toward the user avatar; classic fills it with the neutral secondary background, bubble with the brand color. Classic
 * lays the assistant reply flat on the page, bubble wraps it in a secondary-colored bubble. A classic reply spanning the
 * full-width column fills it so code blocks and tables use the column; a bubble keeps fitting its content.
 */
export function getConversationContentClassName({
  layout,
  role,
  isSmallScreen,
  errorOnly,
  spansColumn = false,
}: {
  layout: MessageLayout
  role: 'user' | 'assistant'
  isSmallScreen: boolean
  errorOnly: boolean
  spansColumn?: boolean
}): string {
  const padding = isSmallScreen ? BUBBLE_PADDING.small : BUBBLE_PADDING.wide
  if (role === 'user') {
    return cn(
      'inline-block max-w-full min-w-0 rounded-2xl',
      isUserMessageOnRight(layout)
        ? 'rounded-tr-[4px] bg-[var(--mantine-color-chatbox-brand-filled)] text-white'
        : 'rounded-tl-[4px] bg-chatbox-background-secondary',
      padding
    )
  }
  if (errorOnly) return 'max-w-full min-w-0'
  if (layout === 'classic') return cn('max-w-full min-w-0', spansColumn && 'w-full')
  return cn('inline-block max-w-full min-w-0 rounded-2xl rounded-tl-[4px] bg-chatbox-background-secondary', padding)
}

/** Whether the message content is drawn on a bubble surface: user messages, and bubble-layout replies with content. */
export function hasConversationContentSurface({
  layout,
  role,
  errorOnly,
}: {
  layout: MessageLayout
  role: 'user' | 'assistant'
  errorOnly: boolean
}): boolean {
  return role === 'user' || (layout === 'bubble' && !errorOnly)
}

/**
 * Pressed tint for a long-press surface, drawn inside the bubble behind its text so the name row, avatar and tips around
 * the bubble stay uncovered.
 */
export function getLongPressSurfaceClassName(pressed: boolean): string {
  return cn(
    "relative isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:content-['']",
    'before:transition-colors before:duration-200',
    pressed ? 'before:bg-black/[0.08] dark:before:bg-white/[0.08]' : 'before:bg-transparent'
  )
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
