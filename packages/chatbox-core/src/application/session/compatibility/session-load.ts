import { buildSwitchForkToPatch, findMessageLocation, forkTailStartIndex } from '@shared/session/message-forks'
import type { Message, Session } from '@shared/types'
import { finalizeStaleGeneratingMessage, isStaleGeneratingMessage, migrateMessage } from '@shared/utils/message'

interface MessageLoadResult {
  message: ReturnType<typeof migrateMessage> | null
  recoveredStaleGeneration: boolean
}

function isBlankGenerationPlaceholder(message: ReturnType<typeof migrateMessage>): boolean {
  if (message.role !== 'assistant' || message.files?.length || message.links?.length) return false
  const legacyGenerationRequests = (
    message as ReturnType<typeof migrateMessage> & { generationRequests?: readonly unknown[] }
  ).generationRequests
  if (
    message.error !== undefined ||
    message.errorCode !== undefined ||
    message.backgroundTask !== undefined ||
    legacyGenerationRequests?.length
  ) {
    return false
  }

  return message.contentParts.every(
    (part) => (part.type === 'text' || part.type === 'reasoning') && part.text.length === 0
  )
}

function loadMessage(message: Message, bootTime?: number): MessageLoadResult {
  if (!isStaleGeneratingMessage(message, bootTime)) {
    return { message, recoveredStaleGeneration: false }
  }
  if (isBlankGenerationPlaceholder(message)) {
    return { message: null, recoveredStaleGeneration: true }
  }
  return {
    message: finalizeStaleGeneratingMessage(message, bootTime),
    recoveredStaleGeneration: true,
  }
}

function loadMessages(messages: Session['messages'] | undefined, bootTime?: number) {
  let recoveredStaleGeneration = false
  const loaded = [] as Session['messages']

  for (const message of messages || []) {
    const result = loadMessage(message, bootTime)
    recoveredStaleGeneration ||= result.recoveredStaleGeneration
    if (result.message) loaded.push(result.message)
  }

  return { messages: loaded, recoveredStaleGeneration }
}

export interface SessionLoadRecovery {
  session: Session
  recoveredStaleGeneration: boolean
}

function activeForkTailWasRemoved(original: Session, recovered: Session, pivotId: string, bootTime?: number): boolean {
  const originalLocation = findMessageLocation(original, pivotId)
  if (!originalLocation) return false

  const originalTail = originalLocation.list.slice(forkTailStartIndex(originalLocation.list, originalLocation.index))
  if (
    !originalTail.some(
      (message) => isStaleGeneratingMessage(message, bootTime) && isBlankGenerationPlaceholder(message)
    )
  ) {
    return false
  }

  const recoveredLocation = findMessageLocation(recovered, pivotId)
  return Boolean(
    recoveredLocation &&
      forkTailStartIndex(recoveredLocation.list, recoveredLocation.index) >= recoveredLocation.list.length
  )
}

function promoteRecoveredForkBranches(original: Session, recovered: Session, bootTime?: number): Session {
  let result = recovered
  for (const pivotId of Object.keys(recovered.messageForksHash || {})) {
    const fork = result.messageForksHash?.[pivotId]
    if (!fork || !activeForkTailWasRemoved(original, result, pivotId, bootTime)) continue

    if (fork.lists.length <= 1) {
      const { [pivotId]: _removed, ...remainingForks } = result.messageForksHash || {}
      result = {
        ...result,
        messageForksHash: Object.keys(remainingForks).length ? remainingForks : undefined,
      }
      continue
    }

    const targetPosition = fork.position + 1 < fork.lists.length ? fork.position + 1 : fork.position - 1
    const patch = buildSwitchForkToPatch(result, pivotId, targetPosition)
    if (patch) result = { ...result, ...patch }
  }

  return result
}

export function recoverSessionOnLoad(session: Session, bootTime?: number): SessionLoadRecovery {
  const migrated = migrateSession(session)
  let recoveredStaleGeneration = false
  const currentMessages = loadMessages(migrated.messages, bootTime)
  recoveredStaleGeneration ||= currentMessages.recoveredStaleGeneration

  const threads = migrated.threads?.map((thread) => {
    const result = loadMessages(thread.messages, bootTime)
    recoveredStaleGeneration ||= result.recoveredStaleGeneration
    return { ...thread, messages: result.messages }
  })

  let collapsedRecoveredFork = false
  const recoveredForkEntries = Object.entries(migrated.messageForksHash || {}).flatMap(([pivotId, forks]) => {
    const recoveredLists = (forks.lists || []).map((list, index) => {
      const result = loadMessages(list.messages, bootTime)
      recoveredStaleGeneration ||= result.recoveredStaleGeneration
      return {
        index,
        list: { ...list, messages: result.messages },
        removedStalePlaceholder: result.recoveredStaleGeneration && result.messages.length === 0,
      }
    })
    const validLists = recoveredLists.filter(
      ({ index, removedStalePlaceholder }) => index === forks.position || !removedStalePlaceholder
    )
    const removedInactivePlaceholder = recoveredLists.some(
      ({ index, removedStalePlaceholder }) => index !== forks.position && removedStalePlaceholder
    )

    if (removedInactivePlaceholder && validLists.length <= 1) {
      collapsedRecoveredFork = true
      return []
    }

    return [
      [
        pivotId,
        {
          ...forks,
          position: validLists.findIndex(({ index }) => index === forks.position),
          lists: validLists.map(({ list }) => list),
        },
      ] as const,
    ]
  })
  const messageForksHash = recoveredForkEntries.length
    ? Object.fromEntries(recoveredForkEntries)
    : collapsedRecoveredFork
      ? undefined
      : migrated.messageForksHash

  const recoveredSession = {
    ...migrated,
    messages: currentMessages.messages,
    threads,
    messageForksHash,
  }
  return {
    recoveredStaleGeneration,
    session: recoveredStaleGeneration
      ? promoteRecoveredForkBranches(migrated, recoveredSession, bootTime)
      : recoveredSession,
  }
}

export function migrateSession(session: Session): Session {
  return {
    ...session,
    settings: {
      temperature: undefined,
      ...session.settings,
    },
    messages: session.messages?.map((message) => migrateMessage(message)) || [],
    threads: session.threads?.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => migrateMessage(message)) || [],
    })),
    messageForksHash: Object.fromEntries(
      Object.entries(session.messageForksHash || {}).map(([pivotId, forks]) => [
        pivotId,
        {
          ...forks,
          lists:
            forks.lists?.map((list) => ({
              ...list,
              messages: list.messages?.map((message) => migrateMessage(message)) || [],
            })) || [],
        },
      ])
    ),
  }
}
