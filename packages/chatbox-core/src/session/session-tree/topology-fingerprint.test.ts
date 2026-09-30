import { describe, expect, it } from 'vitest'
import { encodeSessionTree, sessionTopologyFingerprint } from './encode'
import {
  deriveLegacySessionTopologyFingerprint,
  deriveSessionTopologyFingerprint,
  updateSessionTopologyFingerprint,
} from './topology-fingerprint'
import type { MessageRow, ThreadRow } from './types'

const session = {
  id: 's',
  name: 'S',
  messages: [
    { id: 'a', role: 'user' as const, contentParts: [] },
    { id: 'b', role: 'assistant' as const, contentParts: [] },
  ],
}
function tree() {
  const result = encodeSessionTree(session, { activeThreadId: session.id, now: 0 })
  if (!result.ok) throw new Error(result.reason)
  return result.tree
}

describe('versioned topology identity', () => {
  it('preserves physical row order independence and ignores message bodies', () => {
    const { threads, messages } = tree()
    const fingerprint = deriveSessionTopologyFingerprint(threads, messages)
    expect(deriveSessionTopologyFingerprint([...threads].reverse(), [...messages].reverse())).toBe(fingerprint)
    expect(
      deriveSessionTopologyFingerprint(
        threads,
        messages.map((row) => ({ ...row, message: { ...row.message, generating: true } }))
      )
    ).toBe(fingerprint)
    expect(deriveSessionTopologyFingerprint(threads, [...messages, messages[0], messages[0]])).not.toBe(fingerprint)
  })

  it('includes every topology field and discriminates threads from messages', () => {
    const { threads, messages } = tree()
    const fingerprint = deriveSessionTopologyFingerprint(threads, messages)
    const rowChanges: Partial<MessageRow>[] = [
      { threadId: 'other' },
      { messageId: 'other' },
      { seq: 12 },
      { parentMessageId: 'other' },
      { activeChildId: 'other' },
      { kind: 'summary' },
      { branchId: 'branch' },
    ]
    for (const change of rowChanges)
      expect(deriveSessionTopologyFingerprint(threads, [{ ...messages[0], ...change }, messages[1]])).not.toBe(
        fingerprint
      )
    const threadChanges: Partial<ThreadRow>[] = [
      { threadId: 'other' },
      { seq: 12 },
      { rootMessageId: 'other' },
      { activeLeafMessageId: 'other' },
    ]
    for (const change of threadChanges)
      expect(deriveSessionTopologyFingerprint([{ ...threads[0], ...change }], messages)).not.toBe(fingerprint)
  })

  it('matches full derivation after append, replacement and deletion', () => {
    const { threads, messages } = tree()
    const fingerprint = deriveSessionTopologyFingerprint(threads, messages)
    const appended = { ...messages[1], messageId: 'c', parentMessageId: 'b', seq: 2 }
    const tail = { ...messages[1], activeChildId: 'c' }
    const thread = { ...threads[0], activeLeafMessageId: 'c' }
    const next = updateSessionTopologyFingerprint(
      fingerprint,
      { threads, messages: [messages[1]] },
      { threads: [thread], messages: [tail, appended] }
    )
    expect(next).toBe(deriveSessionTopologyFingerprint([thread], [messages[0], tail, appended]))
    const changed = { ...tail, branchId: 'branch' }
    const replaced = updateSessionTopologyFingerprint(
      next ?? undefined,
      { threads: [], messages: [tail] },
      { threads: [], messages: [changed] }
    )
    expect(replaced).toBe(deriveSessionTopologyFingerprint([thread], [messages[0], changed, appended]))
    expect(
      updateSessionTopologyFingerprint(
        replaced ?? undefined,
        { threads: [thread], messages: [changed, appended] },
        { threads, messages: [messages[1]] }
      )
    ).toBe(fingerprint)
  })

  it('compares persisted unprefixed identities using the legacy algorithm', () => {
    const { threads, messages } = tree()
    const legacy = deriveLegacySessionTopologyFingerprint(threads, messages)
    expect(sessionTopologyFingerprint(session, legacy)).toBe(legacy)
    expect(sessionTopologyFingerprint(session)).toMatch(/^v2:/)
    expect(
      updateSessionTopologyFingerprint(legacy, { threads: [], messages: [] }, { threads: [], messages: [] })
    ).toBeNull()
  })
})
