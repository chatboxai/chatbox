import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, open, readFile, readdir, rm, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransfers } from './file-transfers'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: vi.fn(actual.mkdir), open: vi.fn(actual.open), unlink: vi.fn(actual.unlink) }
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const directories: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
it('writes bounded native output, preserves the existing file on cancel, and scopes handles to a renderer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(join(directory, 'blobs'))
  const target = join(directory, 'saved.zip')
  await writeFile(target, 'previous')
  const first = await files.create(1, target)
  await expect(files.write(2, first, new Uint8Array([1]))).rejects.toThrow('Invalid file transfer handle')
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
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(directory)
  const token = await files.createResource(1, 'image')
  await files.write(1, token, new TextEncoder().encode('🙂text'))
  await files.finish(1, token, true)
  const conflicting = await files.createResource(1, 'image')
  await files.write(1, conflicting, new TextEncoder().encode('replacement'))
  await expect(files.finish(1, conflicting, true)).rejects.toMatchObject({ code: 'EEXIST' })
  await files.finish(1, conflicting, false)
  const input = await files.openResource(1, 'image')
  expect(input?.size).toBe(8)
  expect(new TextDecoder().decode(await files.read(1, input!.token, 0, 8))).toBe('🙂text')
  await files.finish(1, input!.token, false)
  expect(await readFile(join(directory, 'image'), 'utf8')).toBe('🙂text')
})

it('keeps unfinished resource bytes hidden and removes them when their renderer exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(directory)
  const token = await files.createResource(1, 'image')
  await files.write(1, token, new Uint8Array([1, 2, 3]))
  expect(await files.openResource(1, 'image')).toBeNull()
  await files.closeOwner(1)
  expect(await readdir(directory)).toEqual([])
})

it('keeps publication successful when removing its temporary name fails and retries cleanup on owner close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(directory)
  const token = await files.createResource(1, 'image')
  await files.write(1, token, new Uint8Array([1, 2, 3]))
  vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error('cleanup denied'), { code: 'EACCES' }))

  await expect(files.finish(1, token, true)).resolves.toBeUndefined()

  expect([...(await readFile(join(directory, 'image')))]).toEqual([1, 2, 3])
  expect(await readdir(directory)).toHaveLength(2)
  await files.closeOwner(1)
  expect(await readdir(directory)).toEqual(['image'])
})

it.each(['output', 'input'] as const)('closes an %s opened across an owner shutdown', async (kind) => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(directory)
  const target = join(directory, 'saved')
  await writeFile(target, 'previous')
  const entered = deferred()
  const release = deferred()
  const opened: FileHandle[] = []
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode)
    opened.push(handle)
    entered.resolve()
    await release.promise
    return handle
  })
  const opening = kind === 'output' ? files.create(1, target) : files.openResource(1, 'saved')
  await entered.promise
  await files.closeOwner(1)
  release.resolve()

  await expect(opening).rejects.toThrow('owner has closed')

  expect(opened[0]?.fd).toBe(-1)
  expect(await readdir(directory)).toEqual(['saved'])
  expect(await readFile(target, 'utf8')).toBe('previous')
  const next = await files.create(1, join(directory, 'next'))
  await files.finish(1, next, false)
})

it('rejects resource creation whose directory setup crossed an owner shutdown', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'chatbox-file-transfer-'))
  directories.push(directory)
  const files = new FileTransfers(directory)
  const entered = deferred()
  const release = deferred()
  vi.mocked(mkdir).mockImplementationOnce(async (path, options) => {
    const result = await actual.mkdir(path, options)
    entered.resolve()
    await release.promise
    return result
  })
  const creating = files.createResource(1, 'image')
  await entered.promise
  await files.closeOwner(1)
  release.resolve()

  await expect(creating).rejects.toThrow('owner has closed')
  expect(await readdir(directory)).toEqual([])
})
