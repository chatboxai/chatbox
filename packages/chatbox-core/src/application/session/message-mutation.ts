import { findMessageLocation } from '../../session/message-forks'
import type { SessionMessageMutation } from '../../ports/session-repository'
import type { Message, Session, Updater } from '../../types'
import { getSessionMessageTokenizationText } from './message-derived-data'
import { applyMessageInsert, applyMessageUpdate } from './message-tree'
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
    return { session: applySessionMessageMutation(session, operation), mutation: operation }
  }
  const location = findMessageLocation(session, operation.messageId)
  const message = location?.list[location.index]
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
  return { session: mutation ? applySessionMessageMutation(session, mutation) : session, mutation }
}

export function applySessionMessageMutation(session: Session, mutation: SessionMessageMutation): Session {
  if (mutation.type === 'append') {
    return mutation.messages.reduce((current, message) => applyMessageInsert(current, session.id, message), session)
  }
  return applyMessageUpdate(session, session.id, mutation.messageId, mutation.message)
}
