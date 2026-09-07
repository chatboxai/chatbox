import type { Message, Session } from '../../types/session'
import { applySessionMessageDerivedPatch, type SessionMessageDerivedPatch } from './message-derived-data'

/** Replays narrow changes onto a complete snapshot that is already in memory. */
export function applySessionDerivedPatches(session: Session, patches: SessionMessageDerivedPatch[]) {
  if (!patches.length) return { session, patches: [] }
  const byId = new Map<string, { patch: SessionMessageDerivedPatch; index: number }[]>()
  patches.forEach((patch, index) => {
    const entries = byId.get(patch.messageId) ?? []
    entries.push({ patch, index })
    byId.set(patch.messageId, entries)
  })
  const accepted = new Map<number, SessionMessageDerivedPatch>()
  function updateMessages(messages: Message[]): Message[] {
    let changed = false
    const updated = messages.map((message) => {
      const entries = byId.get(message.id)
      if (!entries) return message
      byId.delete(message.id)
      let current = message
      for (const { patch, index } of entries) {
        const result = applySessionMessageDerivedPatch(current, patch)
        if (!result) continue
        current = result.message
        accepted.set(index, result.patch)
      }
      changed ||= current !== message
      return current
    })
    return changed ? updated : messages
  }
  const messages = updateMessages(session.messages)
  let threads = session.threads
  if (threads) {
    const updated = threads.map((thread) => {
      const messages = updateMessages(thread.messages)
      return messages === thread.messages ? thread : { ...thread, messages }
    })
    if (updated.some((thread, index) => thread !== threads?.[index])) threads = updated
  }
  let forks = session.messageForksHash
  for (const [id, fork] of Object.entries(forks ?? {})) {
    const lists = fork.lists.map((list) => {
      const messages = updateMessages(list.messages)
      return messages === list.messages ? list : { ...list, messages }
    })
    if (lists.some((list, index) => list !== fork.lists[index])) {
      if (!forks || forks === session.messageForksHash) forks = { ...forks }
      forks[id] = { ...fork, lists }
    }
  }
  let updated = session
  if (messages !== session.messages) updated = { ...updated, messages }
  if (threads !== session.threads) updated = { ...updated, threads }
  if (forks !== session.messageForksHash) updated = { ...updated, messageForksHash: forks }
  return { session: updated, patches: patches.flatMap((_, index) => accepted.get(index) ?? []) }
}
