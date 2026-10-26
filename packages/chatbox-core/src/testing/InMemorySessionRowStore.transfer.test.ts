import { expect, it } from 'vitest'
import { prepareSessionRowsFixture } from '../ports/testing/session-row-fixtures'
import { InMemorySessionRowStore } from './InMemorySessionRowStore'

it('rejects invalid revisions and duplicate message identities', async () => {
  const store = new InMemorySessionRowStore()
  const fixture = prepareSessionRowsFixture({
    id: 'target',
    name: 'Rows',
    messages: [{ id: 'm', role: 'user', contentParts: [] }],
  })
  await expect(store.stageRows({ record: fixture.session, revision: 2 }, null)).rejects.toThrow('revision')
  const writer = await store.stageRows({ record: fixture.session, revision: 1 }, null)
  for (const thread of fixture.threads) await writer.appendThread(thread)
  for (const row of fixture.messages) await writer.appendMessage(row)
  await expect(writer.appendMessage(fixture.messages[0])).rejects.toThrow('Invalid staged message')
  expect(await store.hasRows('target')).toBe(false)
  await writer.dispose()
})

it('keeps staged complete messages invisible until atomic publication', async () => {
  const store = new InMemorySessionRowStore()
  const text = '你好🙂'.repeat(100_000)
  const fixture = prepareSessionRowsFixture({
    id: 'source',
    name: 'Rows',
    messages: [{ id: 'active', role: 'user', contentParts: [{ type: 'text', text }] }],
  })
  const writer = await store.stageRows({ record: fixture.session, revision: 1 }, null)
  for (const thread of fixture.threads) await writer.appendThread(thread)
  for (const message of fixture.messages) await writer.appendMessage(message)
  expect(await store.hasRows('source')).toBe(false)
  await writer.publish()
  await writer.dispose()
  const rows = []
  for await (const row of store.iterateRows({ sessionId: 'source', expectedRevision: 1 })) rows.push(row)
  expect(rows.find((row) => row.kind === 'message')).toMatchObject({
    message: { message: { contentParts: [{ type: 'text', text }] } },
  })
})

it('discards unpublished rows and rejects a concurrent target change', async () => {
  const store = new InMemorySessionRowStore()
  const fixture = prepareSessionRowsFixture({ id: 'target', name: 'Rows', messages: [] })
  const writer = await store.stageRows({ record: fixture.session, revision: 1 }, null)
  for (const thread of fixture.threads) await writer.appendThread(thread)
  await store.writeRows(
    {
      record: { ...fixture.session, name: 'Existing' },
      revision: 1,
      rows: { sessionId: 'target', threads: fixture.threads, messages: [] },
    },
    null
  )
  await expect(writer.publish()).rejects.toThrow('conflict')
  await writer.dispose()
  expect((await store.readCommit('target'))?.record.name).toBe('Existing')
})

it('retains numeric tokens through metadata changes and rejects replaced payload sources', async () => {
  const store = new InMemorySessionRowStore()
  const tree = prepareSessionRowsFixture({
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
