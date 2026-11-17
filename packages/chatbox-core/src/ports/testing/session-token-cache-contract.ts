import { expect, vi } from 'vitest'
import type { SessionRowStorePort } from '../session-row-store'
import { SESSION_TOKEN_CACHE_VERSION } from '../session-token-cache'
import { relationFixture } from './session-row-relations-contract'

export const tokenCacheKey = `${SESSION_TOKEN_CACHE_VERSION}:default:0:0`
export async function testTokenCache(store: SessionRowStorePort) {
  const fixture = relationFixture()
  await store.writeRows(fixture)
  const body = vi.spyOn(store, 'readMessages')
  const whole = vi.spyOn(store, 'readSnapshot')
  const request = { sessionId: 'transcript', messageIds: ['active-2'], expectedRevision: 1, cacheKey: tokenCacheKey }
  const initial = (await store.readTokenCache(request))!
  expect(initial.entries).toHaveLength(1)
  expect(initial.entries[0].value).toBeUndefined()
  const value = { text: 12, attachments: 3, toolCalls: 1, approximate: false }
  await store.acceptTokenCache([{ identity: initial.entries[0], cacheKey: tokenCacheKey, value }])
  expect((await store.readTokenCache(request))?.entries[0].value).toEqual(value)
  expect(await store.getRevision('transcript')).toBe(1)
  expect(body).not.toHaveBeenCalled()
  expect(whole).not.toHaveBeenCalled()
  await store.applyDiff(
    { sessionId: 'transcript', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
    { record: { ...fixture.record, name: 'Renamed' }, revision: 2 },
    1
  )
  expect((await store.readTokenCache({ ...request, expectedRevision: 2 }))?.entries[0]).toEqual({
    ...initial.entries[0],
    value,
  })
  const row = fixture.rows.messages.find((row) => row.messageId === 'active-2')!
  await store.applyDiff(
    {
      sessionId: 'transcript',
      threads: { upsert: [], delete: [] },
      messages: {
        upsert: [{ ...row, message: { ...row.message, contentParts: [{ type: 'text', text: 'changed' }] } }],
        delete: [],
      },
    },
    { record: fixture.record, revision: 3 },
    2
  )
  await store.acceptTokenCache([{ identity: initial.entries[0], cacheKey: tokenCacheKey, value }])
  const changed = (await store.readTokenCache({ ...request, expectedRevision: 3 }))!.entries[0]
  expect(changed.payloadId).not.toBe(initial.entries[0].payloadId)
  expect(changed.value).toBeUndefined()
  expect(body).not.toHaveBeenCalled()
}
