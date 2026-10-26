import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BackupResourceFiles } from './backup-resource-files'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-backup-resource-'))
  directories.push(directory)
  const blobs = join(directory, 'chatbox-blobs')
  await mkdir(blobs)
  return { directory, blobs, files: new BackupResourceFiles(directory) }
}
describe('native backup resource replacement', () => {
  it('atomically overwrites one resource and retains it when job cleanup runs after restart', async () => {
    const { directory, blobs, files } = await fixture()
    await writeFile(join(blobs, 'resourceone'), 'old')
    await writeFile(join(blobs, 'unrelated'), 'untouched')
    const candidate = await files.candidate('job-1', 'resource:one')
    await writeFile(candidate, 'new')
    expect(await readFile(join(blobs, 'resourceone'), 'utf8')).toBe('old')
    await files.publish('job-1', 'resource:one')
    expect(await readFile(join(blobs, 'resourceone'), 'utf8')).toBe('new')
    expect((await readdir(join(directory, 'backup-jobs', 'job-1'))).every((name) => name.endsWith('.target'))).toBe(
      true
    )
    const reopened = new BackupResourceFiles(directory)
    await reopened.cleanup('job-1')
    await reopened.cleanup('job-1')
    expect(await readFile(join(blobs, 'resourceone'), 'utf8')).toBe('new')
    expect(await readFile(join(blobs, 'unrelated'), 'utf8')).toBe('untouched')
    expect(await readdir(join(directory, 'backup-jobs'))).toEqual([])
  })
  it('discards incomplete candidates without changing live resources', async () => {
    const { files, blobs } = await fixture()
    await writeFile(join(blobs, 'existing'), 'old')
    await writeFile(await files.candidate('job', 'existing'), 'partial')
    await writeFile(await files.candidate('job', 'new'), 'partial')
    await files.cleanup('job')
    expect(await readFile(join(blobs, 'existing'), 'utf8')).toBe('old')
    await expect(readFile(join(blobs, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects aliases for the same native destination and unsafe job identities', async () => {
    const { files } = await fixture()
    const first = await files.candidate('job', 'a:b')
    expect(await files.candidate('job', 'a:b')).toBe(first)
    await expect(files.candidate('job', 'ab')).rejects.toThrow('same storage path')
    await expect(files.candidate('../escape', 'safe')).rejects.toThrow('identity')
    await expect(files.candidate('job', '..')).rejects.toThrow('key')
  })
  it('does not remove live content when the candidate is missing', async () => {
    const { files, blobs } = await fixture()
    await writeFile(join(blobs, 'target'), 'live')
    await expect(files.publish('missing', 'target')).rejects.toThrow()
    expect(await readFile(join(blobs, 'target'), 'utf8')).toBe('live')
  })
})
