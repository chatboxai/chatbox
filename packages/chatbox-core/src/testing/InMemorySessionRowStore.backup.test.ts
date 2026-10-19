import { expect, it } from 'vitest'
import { prepareLegacySessionRows, stageLegacySessionRows } from '../backup/legacy-row-import'
import { DEFAULT_BACKUP_PAGE_LIMITS } from '../backup/session-port'
import { verifyCandidateFormatUpgrade } from '../ports/testing/session-row-migration-contract'
import { InMemorySessionRowStore } from './InMemorySessionRowStore'

it('upgrades memory candidates atomically and restores their prior revision', async () => {
  await verifyCandidateFormatUpgrade(new InMemorySessionRowStore())
})
it('streams only the requested thread and publishes complete payload chunks', async () => {
  const source = new InMemorySessionRowStore()
  const session = {
    id: 'source',
    name: 'Rows',
    messages: [
      { id: 'active', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'large'.repeat(40000) }] },
    ],
    threads: [
      {
        id: 'old',
        name: 'Old',
        createdAt: 1,
        messages: [{ id: 'old-message', role: 'user' as const, contentParts: [] }],
      },
    ],
  }
  const candidate = await stageLegacySessionRows(source, session)
  await candidate.publish()
  await candidate.dispose()
  const exported = []
  for await (const row of source.iterateBackupRows('source', DEFAULT_BACKUP_PAGE_LIMITS, undefined, 'source'))
    exported.push(row)
  expect(exported.filter((row) => row.kind === 'thread').map((row) => row.thread.threadId)).toEqual(['source'])
  const body = exported.find((row) => row.kind === 'message')
  expect(body?.kind === 'message' && body.payload?.size).toBeGreaterThan(128 * 1024)
  expect((await source.readMessages({ sessionId: 'source', messageIds: ['active'] }))?.messages[0].message).toEqual(
    session.messages[0]
  )
})
it('retains numeric tokens through metadata changes and rejects replaced payload sources', async () => {
  const store = new InMemorySessionRowStore()
  const tree = prepareLegacySessionRows({
    id: 'tokens',
    name: 'Tokens',
    messages: [{ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'before' }] }],
  })
  await store.writeRows({
    record: tree.session,
    revision: 1,
    rows: { sessionId: 'tokens', threads: tree.threads, messages: tree.messages },
  })
  const original = (await store.readMessages({ sessionId: 'tokens', messageIds: ['user'] }))!
  const source = original.textTokens!.sources.user
  const result = {
    source,
    value: { tokenizerType: 'default' as const, sourceDigest: source.textDigest, tokens: 2, calculatedAt: 1 },
  }
  expect(await store.acceptTextTokenResults([result])).toHaveLength(1)
  expect(await store.getRevision('tokens')).toBe(1)
  expect((await store.readMessages({ sessionId: 'tokens', messageIds: ['user'] }))?.messages).toEqual(original.messages)
  const { message, ...metadata } = tree.messages[0]
  await store.applyDiff(
    {
      sessionId: 'tokens',
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
      messageMetadataUpsert: [{ ...metadata, updatedAt: 4 }],
    },
    { record: tree.session, revision: 2 },
    1
  )
  expect(
    (await store.readMessages({ sessionId: 'tokens', messageIds: ['user'] }))?.textTokens?.sources.user.payloadId
  ).toBe(source.payloadId)
  expect(await store.readTextTokenResults([source])).toHaveLength(1)
  await store.applyDiff(
    {
      sessionId: 'tokens',
      threads: { upsert: [], delete: [] },
      messages: {
        upsert: [{ ...tree.messages[0], message: { ...message, contentParts: [{ type: 'text', text: 'after' }] } }],
        delete: [],
      },
    },
    { record: tree.session, revision: 3 },
    2
  )
  expect(await store.acceptTextTokenResults([result])).toEqual([])
  expect((await store.readMessages({ sessionId: 'tokens', messageIds: ['user'] }))?.textTokens?.results).toEqual([])
})
