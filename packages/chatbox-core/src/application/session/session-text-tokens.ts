import type { SessionTextTokenRead, SessionTextTokenResult } from '../../ports/session-text-tokens'
import type { Message, Session } from '../../types/session'
import { applySessionMessageDerivedPatch, getSessionMessageTokenizationText } from './message-derived-data'
import { applySessionDerivedPatches } from './session-derived-data'

/** Only estimated input text caches; output tokenCount, usage and attachment caches remain content-owned. */
export function withoutEstimatedTextTokens(message: Message): Message {
  const {
    tokenCountMap: _counts,
    tokenCalculatedAt: _clocks,
    tokenCountApproximate: _approximate,
    ...content
  } = message
  return content
}

export function mapSessionMessages(session: Session, update: (message: Message) => Message): Session {
  const map = (messages: Message[]) => {
    const next = messages.map(update)
    return next.every((message, index) => message === messages[index]) ? messages : next
  }
  const messages = map(session.messages)
  const threads = session.threads?.map((thread) => {
    const messages = map(thread.messages)
    return messages === thread.messages ? thread : { ...thread, messages }
  })
  const messageForksHash =
    session.messageForksHash &&
    Object.fromEntries(
      Object.entries(session.messageForksHash).map(([key, fork]) => {
        const lists = fork.lists.map((list) => {
          const messages = map(list.messages)
          return messages === list.messages ? list : { ...list, messages }
        })
        return [key, lists.every((list, i) => list === fork.lists[i]) ? fork : { ...fork, lists }]
      })
    )
  const nextThreads = threads?.every((thread, i) => thread === session.threads?.[i]) ? session.threads : threads
  const nextForks =
    messageForksHash &&
    Object.keys(messageForksHash).every((key) => messageForksHash[key] === session.messageForksHash?.[key])
      ? session.messageForksHash
      : messageForksHash
  // Writes recognize their baseline by identity, so an unchanged session stays the same object.
  if (messages === session.messages && nextThreads === session.threads && nextForks === session.messageForksHash) {
    return session
  }
  return { ...session, messages, threads: nextThreads, messageForksHash: nextForks }
}

/** Merge calculated values only for the payload identities owned by this read. */
export function mergeSessionTextTokenResults(
  read: SessionTextTokenRead,
  incoming: readonly SessionTextTokenResult[]
): SessionTextTokenRead {
  const results = new Map<string, SessionTextTokenResult>()
  for (const result of [...read.results, ...incoming]) {
    const source = read.sources[result.source.messageId]
    if (
      !source ||
      source.sessionId !== result.source.sessionId ||
      source.payloadId !== result.source.payloadId ||
      source.calculationVersion !== result.source.calculationVersion ||
      source.textDigest !== result.source.textDigest
    )
      continue
    const key = `${source.messageId}:${result.value.tokenizerType}`
    if (result.value.calculatedAt >= (results.get(key)?.value.calculatedAt ?? 0)) results.set(key, result)
  }
  return { ...read, results: [...results.values()] }
}

export function textTokenPatches(results: readonly SessionTextTokenResult[]) {
  return results.map(({ source, value }) => ({ messageId: source.messageId, text: [value] }))
}

export function overlayTextTokenMessages(messages: Message[], read: SessionTextTokenRead | undefined): Message[] {
  if (!read?.results.length) return messages
  const byId = new Map<string, SessionTextTokenResult[]>()
  for (const result of read.results) {
    const values = byId.get(result.source.messageId) ?? []
    values.push(result)
    byId.set(result.source.messageId, values)
  }
  return messages.map((message) => {
    let current = message
    for (const { source, value } of byId.get(message.id) ?? []) {
      if (read.sources[message.id]?.payloadId !== source.payloadId) continue
      current = applySessionMessageDerivedPatch(current, { messageId: message.id, text: [value] })?.message ?? current
    }
    return current
  })
}

export function overlaySessionTextTokens(session: Session, read: SessionTextTokenRead | undefined): Session {
  return read?.results.length ? applySessionDerivedPatches(session, textTokenPatches(read.results)).session : session
}

/** Restore content-owned seed caches before writing a numerical view. New messages retain their draft seeds. */
export function restorePersistedTextTokens(session: Session, persisted: Session | Iterable<Message>): Session {
  const originals = new Map<string, Message>()
  if (Symbol.iterator in persisted) {
    for (const message of persisted) originals.set(message.id, message)
  } else {
    mapSessionMessages(persisted, (message) => {
      originals.set(message.id, message)
      return message
    })
  }
  return mapSessionMessages(session, (message) => {
    const original = originals.get(message.id)
    if (!original || original === message) return message
    return restoreMessageTextTokens(message, original)
  })
}

/** Preserve persisted seed fields while accepting only this message's content change. */
export function restoreMessageTextTokens(message: Message, original: Message): Message {
  const content = withoutEstimatedTextTokens(message)
  if (
    message.contentParts !== original.contentParts &&
    getSessionMessageTokenizationText(message) !== getSessionMessageTokenizationText(original)
  )
    return content
  const restored = {
    ...content,
    tokenCountMap: original.tokenCountMap,
    tokenCalculatedAt: original.tokenCalculatedAt,
    tokenCountApproximate: original.tokenCountApproximate,
  }
  const keys = Object.keys({ ...original, ...restored }) as (keyof Message)[]
  return keys.every((key) => restored[key] === original[key]) ? original : restored
}

/** An edited text cannot inherit a seed merely because its timestamps were copied. */
export function clearChangedTextTokenSeeds(session: Session, previous: Session): Session {
  const originals = new Map<string, Message>()
  mapSessionMessages(previous, (message) => {
    originals.set(message.id, message)
    return message
  })
  return mapSessionMessages(session, (message) => {
    const original = originals.get(message.id)
    return original &&
      original.contentParts !== message.contentParts &&
      (message.tokenCountMap || message.tokenCalculatedAt || message.tokenCountApproximate) &&
      getSessionMessageTokenizationText(original) !== getSessionMessageTokenizationText(message)
      ? withoutEstimatedTextTokens(message)
      : message
  })
}
