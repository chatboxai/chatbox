import { describe, expect, it, vi } from 'vitest'
import { toDbOpenError, useDbSchemaGuardStore, watchDbVersionChange } from '../db-schema-guard'
import { IndexedDBImageGenerationStorage } from '../ImageGenerationStorage'
import { IndexedDBSessionMetaStorage } from '../SessionMetaStorage'

type RetryableStorageInternals = {
  openDatabase: () => Promise<void>
}

describe('IndexedDB lifecycle', () => {
  it('closes the current connection and reports when its database version changes', () => {
    const close = vi.fn()
    const onReleased = vi.fn()
    const db = { close, onversionchange: null } as unknown as IDBDatabase
    useDbSchemaGuardStore.setState({ upgradedElsewhereDbName: null })

    watchDbVersionChange('test-db', db, onReleased)
    db.onversionchange?.call(db, {} as IDBVersionChangeEvent)

    expect(close).toHaveBeenCalledOnce()
    expect(onReleased).toHaveBeenCalledOnce()
    expect(useDbSchemaGuardStore.getState().upgradedElsewhereDbName).toBe('test-db')
  })

  it('turns a version mismatch into an update-guidance error', () => {
    useDbSchemaGuardStore.setState({ schemaTooNewDbName: null })

    const result = toDbOpenError('test-db', new DOMException('schema is newer', 'VersionError'))

    expect(result).toMatchObject({ name: 'DbSchemaTooNewError', dbName: 'test-db' })
    expect(useDbSchemaGuardStore.getState().schemaTooNewDbName).toBe('test-db')
  })

  it.each([
    ['session metadata', () => new IndexedDBSessionMetaStorage()],
    ['image generation', () => new IndexedDBImageGenerationStorage()],
  ] as const)('retries %s initialization after a transient failure', async (_name, createStorage) => {
    const storage = createStorage()
    const internals = storage as unknown as RetryableStorageInternals
    const transientError = new Error('transient IndexedDB failure')
    internals.openDatabase = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValueOnce(undefined)

    await expect(storage.initialize()).rejects.toBe(transientError)
    await expect(storage.initialize()).resolves.toBeUndefined()

    expect(internals.openDatabase).toHaveBeenCalledTimes(2)
  })
})
