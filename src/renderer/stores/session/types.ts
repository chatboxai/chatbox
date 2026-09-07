import type { Message, Session } from '@shared/types'

export type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
export type MessageLocation = { list: Message[]; index: number }
export type AgentModeEntrySource = 'suggestion_accept' | 'locked_session' | 'manual' | 'none'
