import { getChatBridgeDebateArenaState } from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'
import type { ReactNode } from 'react'
import { DebateArenaPanel } from './debate-arena/DebateArenaPanel'

export function getChatBridgeSurfaceContent(part: MessageAppPart): ReactNode {
  if (part.appId === 'debate-arena') {
    const state = getChatBridgeDebateArenaState(part.values?.chatbridgeDebateArena)
    return state ? <DebateArenaPanel part={part} state={state} /> : null
  }

  return null
}
