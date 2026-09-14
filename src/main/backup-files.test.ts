import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackupFiles } from './backup-files'
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
it('writes bounded native output, preserves the existing file on cancel, and scopes handles to a renderer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-backup-'))
  directories.push(directory)
  const files = new BackupFiles(join(directory, 'blobs'))
  const target = join(directory, 'saved.zip')
  await writeFile(target, 'previous')
  const first = await files.create(1, target)
  await expect(files.write(2, first, new Uint8Array([1]))).rejects.toThrow('Invalid backup file handle')
  await expect(files.write(1, first, new Uint8Array(65537))).rejects.toThrow('budget')
  await files.write(1, first, new Uint8Array([1, 2]))
  await files.finish(1, first, false)
  expect(await readFile(target, 'utf8')).toBe('previous')
  const second = await files.create(1, target)
  await files.write(1, second, new Uint8Array([3, 4]))
  await files.finish(1, second, true)
  expect([...(await readFile(target))]).toEqual([3, 4])
  const abandoned = await files.create(1, target)
  await files.write(1, abandoned, new Uint8Array([5]))
  await files.closeOwner(1)
  expect(await readdir(directory)).toEqual(['saved.zip'])
})
it('streams existing resource bytes and never overwrites an existing key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-backup-'))
  directories.push(directory)
  const files = new BackupFiles(directory)
  const token = await files.createBlob(1, 'image')
  await files.write(1, token, new TextEncoder().encode('🙂text'))
  await files.finish(1, token, true)
  await expect(files.createBlob(1, 'image')).rejects.toMatchObject({ code: 'EEXIST' })
  const input = await files.openBlob(1, 'image')
  expect(input?.size).toBe(8)
  expect(new TextDecoder().decode(await files.read(1, input!.token, 0, 8))).toBe('🙂text')
  await files.finish(1, input!.token, false)
  expect(await readFile(join(directory, 'image'), 'utf8')).toBe('🙂text')
})
