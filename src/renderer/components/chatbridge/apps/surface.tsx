import { getChatBridgeDebateArenaState, getChatBridgeStoryBuilderState } from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import type { ReactNode } from 'react'
import { DebateArenaPanel } from './debate-arena/DebateArenaPanel'
import { StoryBuilderPanel } from './story-builder/StoryBuilderPanel'

export function getChatBridgeSurfaceContent(part: MessageAppPart): ReactNode {
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
