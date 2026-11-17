import type { SessionAction } from '../session/action-gates'
import type { Message } from '../types'

export interface ForkCommandIdentity {
  seedListId: string
  storedListId: string
  newListId: string
  createdAt: number
}

interface ForkCommandGuard {
  guard?: {
    action: SessionAction
    compactionRunning?: boolean
    activeGenerationMessageIds?: ReadonlySet<string>
  }
}

export type SessionForkOperation = ForkCommandGuard &
  (
    | { action: 'fork-create'; pivotId: string; identity: ForkCommandIdentity; append?: Message[] }
    | { action: 'fork-switch'; pivotId: string; target: 'next' | 'prev' | number | { branchId: string } }
    | { action: 'fork-delete'; pivotId: string }
    | {
        action: 'fork-save-resend'
        targetMessageId: string
        replacement: Message
        expectedContentParts?: Message['contentParts']
        identity: ForkCommandIdentity
        append?: Message[]
      }
    | { action: 'fork-expand'; pivotId: string }
  )
