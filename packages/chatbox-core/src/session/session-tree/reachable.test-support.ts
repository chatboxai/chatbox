import type { Message, Session } from '../../types'

interface ReachableMessageTraversal {
  messages: Message[]
  seenMessageIds: Set<string>
  visitedForkIds: Set<string>
}

function createReachableMessageTraversal(): ReachableMessageTraversal {
  return {
    messages: [],
    seenMessageIds: new Set(),
    visitedForkIds: new Set(),
  }
}

function collectReachableMessages(
  session: Session,
  initialLists: Message[][],
  traversal: ReachableMessageTraversal = createReachableMessageTraversal()
): ReachableMessageTraversal {
  const pendingLists = [...initialLists]

  for (let listIndex = 0; listIndex < pendingLists.length; listIndex += 1) {
    const list = pendingLists[listIndex]
    if (!list) continue

    for (const message of list) {
      if (!traversal.seenMessageIds.has(message.id)) {
        traversal.seenMessageIds.add(message.id)
        traversal.messages.push(message)
      }

      const fork = session.messageForksHash?.[message.id]
      if (!fork || traversal.visitedForkIds.has(message.id)) {
        continue
      }
      traversal.visitedForkIds.add(message.id)
      for (const branch of fork.lists) {
        pendingLists.push(branch.messages)
      }
    }
  }

  return traversal
}

/** Return every message reachable from the active conversation or a historical thread. */
export function getReachableSessionMessages(session: Session): Message[] {
  return collectReachableMessages(session, [
    session.messages,
    ...(session.threads ?? []).map((thread) => thread.messages),
  ]).messages
}
