import { findMessageContext } from '@shared/session/message-forks'
import type { Message, Session } from '@shared/types'

/** Load resources on the target's causal path, including messages omitted by compaction. */
export async function loadBranchFileMessages(
  loadSession: () => Promise<Session | null>,
  targetMessageId: string
): Promise<Message[]> {
  const session = await loadSession()
  if (!session) return []
  const location = findMessageContext(session, targetMessageId)
  return location ? location.list.slice(0, location.index) : []
}
