import { getChatBridgeDebateArenaState, getChatBridgeStoryBuilderState } from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import type { ReactNode } from 'react'
import { isChatBridgeReviewedAppLaunchPart } from '@/packages/chatbridge/reviewed-app-launch'
import { DebateArenaPanel } from './debate-arena/DebateArenaPanel'
import { ReviewedAppLaunchSurface } from './ReviewedAppLaunchSurface'
import { StoryBuilderPanel } from './story-builder/StoryBuilderPanel'

type ChatBridgeSurfaceContentOptions = {
  part: MessageAppPart
  sessionId?: string
  messageId?: string
}

export function getChatBridgeSurfaceContent({ part, sessionId, messageId }: ChatBridgeSurfaceContentOptions): ReactNode {
  if (
    isChatBridgeReviewedAppLaunchPart(part) &&
    (part.lifecycle === 'launching' || part.lifecycle === 'ready' || part.lifecycle === 'active')
  ) {
    return <ReviewedAppLaunchSurface part={part} sessionId={sessionId} messageId={messageId} />
  }

  if (part.appId === 'story-builder') {
    const state = getChatBridgeStoryBuilderState(part.values?.chatbridgeStoryBuilder)
    return state ? <StoryBuilderPanel part={part} state={state} /> : null
  }

  if (part.appId === 'debate-arena') {
    const state = getChatBridgeDebateArenaState(part.values?.chatbridgeDebateArena)
    return state ? <DebateArenaPanel part={part} state={state} /> : null
  }

  return null
}
