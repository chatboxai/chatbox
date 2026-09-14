import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { expect, it, vi } from 'vitest'
import { webBackupBlobs, readWebBlob, deleteWebBlob, listWebBlobKeys, writeWebBlob } from './web-backup-blobs'
it('round trips chunked resource text through normal reads and cleans up canceled writes', async () => {
  const original = '🙂中文'.repeat(20000)
  await webBackupBlobs.write(
    'backup-resource-test',
    (async function* () {
      for (let i = 0; i < original.length; i += 17001) yield original.slice(i, i + 17001)
    })()
  )
  expect(await readWebBlob('backup-resource-test')).toBe(original)
  expect(await listWebBlobKeys()).toContain('backup-resource-test')
  expect((await listWebBlobKeys()).some((key) => key.startsWith('__chatbox_blob_chunks:'))).toBe(false)
  const read = await webBackupBlobs.read('backup-resource-test')
  let max = 0
  for await (const part of read!) max = Math.max(max, part.length)
  expect(max).toBeLessThanOrEqual(32768)
  await deleteWebBlob('backup-resource-test')
  expect(await webBackupBlobs.has('backup-resource-test')).toBe(false)
  const before = await localforage.keys()
  await expect(
    webBackupBlobs.write(
      'backup-resource-failed',
      (async function* () {
        yield 'partial'
        throw new Error('source failed')
      })()
    )
  ).rejects.toThrow('source failed')
  expect(await localforage.keys()).toEqual(before)
})

it('preserves a chunked resource if a normal replacement write fails', async () => {
  await webBackupBlobs.write(
    'replace-test',
    (async function* () {
      yield 'original'
    })()
  )
  const fail = vi.spyOn(localforage, 'setItem').mockRejectedValueOnce(new Error('quota'))
  await expect(writeWebBlob('replace-test', 'replacement')).rejects.toThrow('quota')
  fail.mockRestore()
  expect(await readWebBlob('replace-test')).toBe('original')
  await writeWebBlob('replace-test', 'replacement')
  expect(await readWebBlob('replace-test')).toBe('replacement')
  await deleteWebBlob('replace-test')
})
