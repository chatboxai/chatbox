import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBBackupWorkspace } from './BackupWorkspace'

const workspaces: IndexedDBBackupWorkspace[] = []
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.dispose()
  vi.unstubAllGlobals()
})
function workspace(id: string) {
  const value = new IndexedDBBackupWorkspace(id)
  workspaces.push(value)
  return value
}
describe('durable backup workspace', () => {
  it('keeps unfinished files unreadable and supports ranges across persisted chunk boundaries', async () => {
    const store = workspace('a'),
      sink = await store.createFile('data')
    const bytes = new Uint8Array(600000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    await sink.write(bytes.subarray(0, 17))
    await sink.write(bytes.subarray(17))
    await expect(store.openFile('data')).rejects.toThrow('unavailable')
    await sink.close()
    const reopened = workspace('a'),
      source = await reopened.openFile('data')
    expect(source.size).toBe(bytes.length)
    expect(await source.readBytes!(250000, 300000)).toEqual(bytes.subarray(250000, 550000))
    await expect(source.readBytes!(-1, 1)).rejects.toThrow('range')
    await source.close()
    await expect(source.readBytes!(0, 1)).rejects.toThrow('closed')
  })
  it('atomically rejects duplicate index keys and iterates insertion order over page boundaries', async () => {
    const store = workspace('catalog')
    const insertions = await Promise.all([store.put('table', 'same', 'first'), store.put('table', 'same', 'second')])
    expect(insertions.filter(Boolean)).toHaveLength(1)
    for (let index = 0; index < 140; index++) await store.put('table', String(140 - index), String(index))
    const entries = []
    for await (const entry of workspace('catalog').entries('table')) entries.push(entry)
    expect(entries).toHaveLength(141)
    expect(entries.slice(1).map((entry) => entry.value)).toEqual(
      Array.from({ length: 140 }, (_, index) => String(index))
    )
    expect(await store.get('table', 'missing')).toBeNull()
  })
  it('aborts partial files and deletes one job without touching another', async () => {
    const first = workspace('a'),
      second = workspace('b')
    const partial = await first.createFile('partial')
    await partial.write(new Uint8Array(300000))
    await partial.abort()
    await expect(first.openFile('partial')).rejects.toThrow('unavailable')
    await first.put('table', 'key', 'first')
    await second.put('table', 'key', 'second')
    const saved = await second.createFile('saved')
    await saved.write(new Uint8Array([1, 2, 3]))
    await saved.close()
    await first.dispose()
    expect(await second.get('table', 'key')).toBe('second')
    const bytes = await second.openFile('saved')
    expect(await bytes.readBytes!(0, 3)).toEqual(new Uint8Array([1, 2, 3]))
    await bytes.close()
    const jobs = await second.listJobIds()
    expect(jobs).toEqual(['b'])
  })
})
