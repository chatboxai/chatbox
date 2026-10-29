import 'fake-indexeddb/auto'
import { createSessionMetaRecord } from '@chatbox/core/application/session'
import type { SessionMetaRepositoryPort } from '@chatbox/core/ports'
import { describe, expect, it } from 'vitest'
import { IndexedDBSessionMetaStorage } from '@/storage/SessionMetaStorage'
import { importReleased, RELEASED_TAG, releasedCommit } from './released-source'

type ReleasedMetaModule = { IndexedDBSessionMetaStorage: new () => SessionMetaRepositoryPort }

describe.skipIf(!releasedCommit)(`session metadata after a downgrade to ${RELEASED_TAG}`, () => {
  it('lists records this version wrote to chatbox-session-meta', async () => {
    const current = new IndexedDBSessionMetaStorage()
    await current.initialize()
    const header = { id: 'created', name: 'Created', type: 'chat' as const, settings: { agentMode: { value: 'off' } } }
    await current.create(createSessionMetaRecord(header, 0, 10))
    await current.create(createSessionMetaRecord({ ...header, id: 'edited', name: 'Before' }, 1, 20))
    await current.update('edited', { name: 'After', starred: true })

    const { IndexedDBSessionMetaStorage: Released } = await importReleased<ReleasedMetaModule>(
      'src/renderer/storage/SessionMetaStorage.ts'
    )
    const released = new Released()
    await released.initialize()
    const records = (await released.getAll()).sort((a, b) => a.id.localeCompare(b.id))
    expect(records.map(({ id, name, starred }) => ({ id, name, starred }))).toEqual([
      { id: 'created', name: 'Created', starred: undefined },
      { id: 'edited', name: 'After', starred: true },
    ])
    expect((await released.getPage(0, 30)).items.map((record) => record.id)).toEqual(['edited', 'created'])
  })
})
