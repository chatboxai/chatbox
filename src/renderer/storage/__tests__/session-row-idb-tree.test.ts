import { expect, it } from 'vitest'
import { relationFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-row-relations-contract'
import { decodeTreeMetadata, encodeTreeMetadata } from '../session-row-idb-tree'

it('round-trips all facts, resources, empty branch order and payload identity through the compact codec', () => {
  const row = relationFixture().rows.messages[0]
  const facts = {
    ...row.facts!,
    seedAttachments: [{ name: '附件😀', storageKey: 'file:one', rawStorageKey: 'raw:one', id: 'a' }],
    fileResourceKeys: ['file:one', 'tool-result:one'],
    imageStorageKeys: ['picture:one'],
    attachmentOwnershipIds: [12],
    paused: true,
    hasToolCall: true,
    hasError: true,
    finishReason: 'stop' as const,
    timestamp: 42,
  }
  const input = {
    ...row,
    facts,
    pendingBranchOrder: Number.MAX_SAFE_INTEGER,
    tokenPayloadId: 'payload:one',
    payloadBytes: 123,
  }
  const encoded = encodeTreeMetadata(input)
  expect(encoded).not.toHaveProperty('facts')
  expect(encoded).not.toHaveProperty('selected')
  expect(decodeTreeMetadata(encoded)).toEqual((({ selected, ...metadata }) => metadata)(input))
})

it('omits empty arrays physically and restores the logical facts contract', () => {
  const row = relationFixture().rows.messages[0]
  const input = { ...row, facts: { ...row.facts!, seedAttachments: [], fileResourceKeys: [] }, payloadBytes: 0 }
  const encoded = encodeTreeMetadata(input)
  for (const key of ['seedAttachments', 'fileResourceKeys', 'imageStorageKeys', 'attachmentOwnershipIds'])
    expect(encoded).not.toHaveProperty(key)
  expect(decodeTreeMetadata(encoded).facts).toEqual(input.facts)
  expect(() => decodeTreeMetadata({ ...encoded, flags: -1 })).toThrow('encoding')
})
