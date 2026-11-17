import { describe, expect, it } from 'vitest'
import type { MessageRow, MessageRowMetadata, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import { planSessionCommand } from './session-command'

const record: SessionRowRecord = {
  id: 's',
  name: 'Rows',
  storageFormat: 'rows',
  rowFormatVersion: 3,
  rowAuthority: 1,
  activeThreadId: 'active',
}
const thread: ThreadRow = {
  sessionId: 's',
  threadId: 'active',
  threadOrder: -1,
  name: null,
  createdAt: 1,
  rootMessageId: 'm1',
  activeLeafMessageId: 'm1',
  compactionPoints: [],
}
const message = (id: string, text = id): MessageRow['message'] => ({
  id,
  role: 'user',
  contentParts: [{ type: 'text', text }],
  timestamp: 1,
})
const row = (id: string, threadId = 'active'): MessageRow => ({
  sessionId: 's',
  threadId,
  messageId: id,
  parentMessageId: null,
  activeChildId: null,
  siblingOrder: 500,
  kind: 'message',
  status: 'settled',
  createdAt: 1,
  updatedAt: 1,
  branchId: null,
  message: message(id),
})
const metadata = (value: MessageRow): MessageRowMetadata => {
  const { message: _message, ...result } = value
  return result
}
const scope = { record, revision: 4, thread }

describe('row command plans', () => {
  it('changes header and active thread name with no payload or derived projection', () => {
    const result = planSessionCommand(scope, { type: 'header', updater: { name: 'Renamed', threadName: 'Topic' } })
    expect(result.record.name).toBe('Renamed')
    expect(result.diff.threads.upsert).toEqual([{ ...thread, name: 'Topic' }])
    expect(result.diff.messages).toEqual({ upsert: [], delete: [] })
  })

  it.each(['archived', 'inactive-branch'])('updates a selected message in %s without the active path', (threadId) => {
    const target = row('target', threadId)
    const result = planSessionCommand(
      scope,
      { type: 'update', messageId: 'target', updater: { contentParts: [{ type: 'text', text: 'Edited' }] } },
      [target]
    )
    expect(result.diff.messages.upsert).toMatchObject([
      { ...target, message: { ...target.message, contentParts: [{ type: 'text', text: 'Edited' }] } },
    ])
    expect(result.diff.threads.upsert).toEqual([])
    expect(result.record).toBe(record)
  })

  it('settles a generating message while preserving its row identity and relations', () => {
    const target = {
      ...row('target'),
      parentMessageId: 'parent',
      activeChildId: 'child',
      status: 'generating' as const,
    }
    target.message.generating = true
    const result = planSessionCommand(scope, { type: 'update', messageId: 'target', updater: { generating: false } }, [
      target,
    ])
    expect(result.diff.messages.upsert[0]).toMatchObject({
      messageId: 'target',
      parentMessageId: 'parent',
      activeChildId: 'child',
      status: 'settled',
      message: { generating: false },
    })
  })

  it('uses sibling order and changes only the append anchor plus new rows', () => {
    const tail = metadata(row('m1'))
    const result = planSessionCommand(
      { ...scope, tail, nextSiblingOrder: 3 },
      { type: 'append', messages: [message('m2'), message('m3')] }
    )
    expect(
      result.diff.messages.upsert.map(({ messageId, parentMessageId, activeChildId, siblingOrder }) => ({
        messageId,
        parentMessageId,
        activeChildId,
        siblingOrder,
      }))
    ).toEqual([
      { messageId: 'm2', parentMessageId: 'm1', activeChildId: 'm3', siblingOrder: 3 },
      { messageId: 'm3', parentMessageId: 'm2', activeChildId: null, siblingOrder: 0 },
    ])
    expect(result.diff.messageMetadataUpsert).toEqual([
      { ...tail, activeChildId: 'm2', pendingBranchId: undefined, pendingBranchOrder: undefined },
    ])
    expect(result.diff.threads.upsert[0].activeLeafMessageId).toBe('m3')
    expect(result.appendedMessageIds).toEqual(['m2', 'm3'])
  })

  it('continues an empty selected branch at its reserved sibling position', () => {
    const tail = { ...metadata(row('m1')), pendingBranchId: 'new-branch', pendingBranchOrder: 2, forkCreatedAt: 10 }
    const result = planSessionCommand({ ...scope, tail }, { type: 'append', messages: [message('m2')] })
    expect(result.diff.messages.upsert[0]).toMatchObject({ branchId: 'new-branch', siblingOrder: 2 })
    expect(result.diff.messageMetadataUpsert?.[0]).toMatchObject({
      forkCreatedAt: 10,
      pendingBranchId: undefined,
      pendingBranchOrder: undefined,
    })
  })

  it('creates the first path in an empty thread', () => {
    const empty = { ...thread, rootMessageId: null, activeLeafMessageId: null }
    const result = planSessionCommand({ ...scope, thread: empty }, { type: 'append', messages: [message('first')] })
    expect(result.diff.messages.upsert[0]).toMatchObject({ parentMessageId: null, siblingOrder: 0 })
    expect(result.diff.threads.upsert[0]).toMatchObject({ rootMessageId: 'first', activeLeafMessageId: 'first' })
  })

  it('keeps an already committed append idempotent and rejects a conflicting identity', () => {
    const existing = row('m1')
    const input = { ...scope, tail: metadata(existing), nextSiblingOrder: 0 }
    const result = planSessionCommand(input, { type: 'append', messages: [existing.message] }, [existing])
    expect(result.diff.messages.upsert).toEqual([])
    expect(result.diff.threads.upsert).toEqual([])
    expect(() =>
      planSessionCommand(input, { type: 'append', messages: [message('m1', 'Different')] }, [existing])
    ).toThrow('already exists')
  })

  it('rejects stale append anchors and identity changes', () => {
    expect(() =>
      planSessionCommand(
        { ...scope, tail: metadata(row('other')), nextSiblingOrder: 0 },
        { type: 'append', messages: [message('new')] }
      )
    ).toThrow('anchor changed')
    expect(() => planSessionCommand(scope, { type: 'header', updater: { id: 'other' } })).toThrow('identity')
    expect(() =>
      planSessionCommand(scope, { type: 'update', messageId: 'm1', updater: { id: 'other' } }, [row('m1')])
    ).toThrow('identity')
  })
})
