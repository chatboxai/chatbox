import { describe, expect, it } from 'vitest'
import type { Message, MessageFile, SessionAttachmentOwnershipClaim } from '../types'
import { collectAttachmentOwnershipClaims, planAttachmentOwnershipTransfers, planOrphanCleanup } from './ownership'

function ragFile(sessionAttachmentId: number | undefined, name = 'doc.pdf'): MessageFile {
  return {
    id: `file-${name}-${sessionAttachmentId ?? 'none'}`,
    name,
    fileType: 'application/pdf',
    ragMode: 'session-retrieval',
    storageKey: `storage-${name}`,
    sessionAttachmentId,
  } as MessageFile
}

function message(id: string, files?: MessageFile[]): Message {
  return {
    id,
    role: 'user',
    contentParts: [{ type: 'text', text: id }],
    files,
  } as Message
}

describe('planAttachmentOwnershipTransfers', () => {
  it('returns nothing when the removed messages carry no indexed attachments', () => {
    expect(planAttachmentOwnershipTransfers([message('m1')], [message('m2', [ragFile(7)])])).toEqual([])
    expect(planAttachmentOwnershipTransfers([message('m1', [ragFile(undefined)])], [message('m2')])).toEqual([])
  })

  it('hands shared attachments to a surviving message that still references them', () => {
    const removed = message('original', [ragFile(42)])
    const survivor = message('replacement', [ragFile(42)])
    expect(planAttachmentOwnershipTransfers([removed], [survivor, message('other')])).toEqual([
      { attachmentId: 42, messageId: 'replacement' },
    ])
  })

  it('leaves unshared attachments with their owner', () => {
    const removed = message('original', [ragFile(42), ragFile(43)])
    const survivor = message('replacement', [ragFile(42)])
    expect(planAttachmentOwnershipTransfers([removed], [survivor])).toEqual([
      { attachmentId: 42, messageId: 'replacement' },
    ])
  })

  it('ignores removed messages that appear in the survivor universe', () => {
    const original = message('original', [ragFile(42)])
    const replacement = message('replacement', [ragFile(42)])
    // Callers pass the full pre-removal message list as survivors.
    expect(
      planAttachmentOwnershipTransfers([original, replacement], [original, replacement, message('other')])
    ).toEqual([])
  })

  it('plans one transfer per attachment even with several survivors and duplicate references', () => {
    const removed = [message('m1', [ragFile(42)]), message('m2', [ragFile(42), ragFile(50)])]
    const survivors = [message('s1', [ragFile(42)]), message('s2', [ragFile(42), ragFile(50)])]
    expect(planAttachmentOwnershipTransfers(removed, survivors)).toEqual([
      { attachmentId: 42, messageId: 's1' },
      { attachmentId: 50, messageId: 's2' },
    ])
  })
})

describe('collectAttachmentOwnershipClaims', () => {
  it('claims each indexed attachment once, for the first message that references it', () => {
    const claims = collectAttachmentOwnershipClaims('session-1', [
      message('m1', [ragFile(7), ragFile(undefined, 'plain.txt')]),
      message('m2', [ragFile(7), ragFile(9)]),
    ])

    expect(claims).toEqual([
      { attachmentId: 7, sessionId: 'session-1', messageId: 'm1' },
      { attachmentId: 9, sessionId: 'session-1', messageId: 'm2' },
    ])
  })

  it('returns nothing for messages without indexed attachments', () => {
    expect(collectAttachmentOwnershipClaims('session-1', [message('m1')])).toEqual([])
  })
})

describe('planOrphanCleanup', () => {
  const scope = (attachmentReferences: SessionAttachmentOwnershipClaim[]) => ({
    sessionIds: ['session-1'],
    messageIds: ['live'],
    attachmentReferences,
  })

  it('keeps rows whose owner is still live', () => {
    expect(planOrphanCleanup([{ id: 7, sessionId: 'session-1', messageId: 'live' }], scope([]))).toEqual({
      deleteIds: [],
      repairs: [],
    })
  })

  it('deletes rows nothing references any more', () => {
    expect(planOrphanCleanup([{ id: 7, sessionId: 'session-1', messageId: 'gone' }], scope([]))).toEqual({
      deleteIds: [7],
      repairs: [],
    })
  })

  it('repairs rows a live message still claims instead of deleting them', () => {
    expect(
      planOrphanCleanup(
        [{ id: 7, sessionId: 'session-1', messageId: 'gone' }],
        scope([{ attachmentId: 7, sessionId: 'session-1', messageId: 'live' }])
      )
    ).toEqual({
      deleteIds: [],
      repairs: [{ attachmentId: 7, sessionId: 'session-1', messageId: 'live' }],
    })
  })

  it('deletes rows whose session is gone even when a stale claim names them', () => {
    expect(
      planOrphanCleanup(
        [{ id: 7, sessionId: 'deleted-session', messageId: 'live' }],
        scope([{ attachmentId: 7, sessionId: 'deleted-session', messageId: 'live' }])
      )
    ).toEqual({ deleteIds: [7], repairs: [] })
  })
})
