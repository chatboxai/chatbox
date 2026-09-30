import { findMessageLocation } from '../../session/message-forks'
import type { SessionMessageMutation } from '../../ports/session-repository'
import type { Message, Session, Updater } from '../../types'
import { getSessionMessageTokenizationText } from './message-derived-data'
import { applyMessageUpdate } from './message-tree'
import { withoutEstimatedTextTokens } from './session-text-tokens'

export type SessionMessageOperation =
  | { type: 'append'; messages: readonly Message[] }
  | { type: 'update'; messageId: string; updater: Updater<Message> }

export function prepareSessionMessageOperation(
  session: Session,
  operation: SessionMessageOperation,
  clearSeeds: boolean
) {
  if (operation.type === 'append') {
    return operation
  }
  const tail = session.messages.at(-1)
  const location = tail?.id === operation.messageId ? undefined : findMessageLocation(session, operation.messageId)
  const message = tail?.id === operation.messageId ? tail : location?.list[location.index]
  const update = message
    ? typeof operation.updater === 'function'
      ? operation.updater(message)
      : operation.updater
    : undefined
  let mutation: SessionMessageMutation | undefined = message
    ? { type: 'replace', messageId: operation.messageId, message: { ...message, ...update } }
    : undefined
  if (
    mutation?.type === 'replace' &&
    clearSeeds &&
    message &&
    message.contentParts !== mutation.message.contentParts &&
    getSessionMessageTokenizationText(message) !== getSessionMessageTokenizationText(mutation.message)
  ) {
    mutation = {
      ...mutation,
      message: {
        ...withoutEstimatedTextTokens(mutation.message),
        tokenCountMap: undefined,
        tokenCalculatedAt: undefined,
        tokenCountApproximate: undefined,
      },
    }
  }
  return mutation
}

export function applySessionMessageMutation(session: Session, mutation: SessionMessageMutation): Session {
  if (mutation.type === 'append') {
    const ids = new Set(session.messages.map((message) => message.id))
    const appended = mutation.messages.filter((message) => {
      if (ids.has(message.id)) return false
      ids.add(message.id)
      return true
    })
    return appended.length ? { ...session, messages: [...session.messages, ...appended] } : session
  }
  if (session.messages.at(-1)?.id === mutation.messageId) {
    const messages = session.messages.slice()
    messages[messages.length - 1] = mutation.message
    return { ...session, messages }
  }
  return applyMessageUpdate(session, session.id, mutation.messageId, mutation.message)
}
