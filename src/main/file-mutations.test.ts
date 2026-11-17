import { chmod, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileEditError } from '../shared/file-edits'
import { editTextFile, withFileMutation, writeTextFile } from './file-mutations'

describe('file mutation coordination', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'chatbox-edit-test-'))
    file = path.join(dir, 'text.txt')
    await writeFile(file, 'alpha\nbeta\n')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('previews without writing, binds approval to content, and rejects stale approval', async () => {
    const edits = [{ search: 'alpha', replace: 'changed' }]
    const preview = await editTextFile({ filePath: file, edits, dryRun: true })
    expect(preview).toMatchObject({ success: true, changed: true })
    expect(await readFile(file, 'utf8')).toBe('alpha\nbeta\n')
    if (!preview.success) throw new Error(preview.error)
    await writeFile(file, 'alpha\nexternal change\n')
    expect(await editTextFile({ filePath: file, edits, expectedVersion: preview.version })).toMatchObject({
      success: false,
      errorCode: 'STALE_CONTENT',
    })
    expect(await readFile(file, 'utf8')).toBe('alpha\nexternal change\n')
  })
  it('commits an approved current preview and leaves the file intact on later-match failure', async () => {
    const edits = [{ search: 'alpha', replace: 'changed' }]
    const preview = await editTextFile({ filePath: file, edits, dryRun: true })
    if (!preview.success) throw new Error(preview.error)
    expect(await editTextFile({ filePath: file, edits, expectedVersion: preview.version })).toMatchObject({
      success: true,
    })
    expect(
      await editTextFile({
        filePath: file,
        edits: [
          { search: 'changed', replace: 'partial' },
          { search: 'missing', replace: '' },
        ],
      })
    ).toMatchObject({ success: false })
    expect(await readFile(file, 'utf8')).toBe('changed\nbeta\n')
  })
  it('rejects oversized and non-regular files before reading their contents', async () => {
    await truncate(file, 4 * 1024 * 1024 + 1)
    for (const [filePath, errorCode] of [
      [file, 'FILE_TOO_LARGE'],
      [dir, 'NOT_REGULAR_FILE'],
      [path.join(dir, 'missing'), 'FILE_NOT_FOUND'],
    ]) {
      expect(await editTextFile({ filePath, search: 'alpha', replace: 'beta', dryRun: true })).toMatchObject({
        success: false,
        errorCode,
      })
    }
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'returns a fixed error for a read-only target',
    async () => {
      await chmod(file, 0o444)
      try {
        expect(await editTextFile({ filePath: file, search: 'alpha', replace: 'changed' })).toEqual(
          fileEditError('WRITE_FAILED')
        )
        expect(await readFile(file, 'utf8')).toBe('alpha\nbeta\n')
      } finally {
        await chmod(file, 0o644)
      }
    }
  )
  it('skips whole-file diff for a large file with a partial-line anchor insertion', async () => {
    await writeFile(file, `anchor\n${(`${'x'.repeat(67)}\n`).repeat(12000)}`)
    const result = await editTextFile({
      filePath: file,
      search: 'anchor',
      replace: 'anchor\ninserted one\ninserted two',
      dryRun: true,
    })
    expect(result).toMatchObject({ success: true, changed: true, diffTruncated: true })
    expect(result).not.toHaveProperty('addedLines')
    expect(result).not.toHaveProperty('removedLines')
    expect(result).not.toHaveProperty('diff')
  })

  it('supports empty-array fallback and returns the committed content version', async () => {
    const first = await editTextFile({ filePath: file, edits: [], search: 'alpha', replace: 'changed' })
    if (!first.success) throw new Error(first.error)
    expect(
      await editTextFile({ filePath: file, search: 'changed', replace: 'next', expectedVersion: first.version })
    ).toMatchObject({ success: true })
    expect(await readFile(file, 'utf8')).toBe('next\nbeta\n')
  })
  it('preserves concurrent disjoint edits including a symlink alias', async () => {
    const alias = path.join(dir, 'alias.txt')
    await symlink(file, alias)
    const results = await Promise.all([
      editTextFile({ filePath: file, edits: [{ search: 'alpha', replace: 'one' }] }),
      editTextFile({ filePath: alias, edits: [{ search: 'beta', replace: 'two' }] }),
    ])
    expect(results.every((result) => result.success)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('one\ntwo\n')
  })
  it('shares the queue with whole-file writes and releases it after errors', async () => {
    let started = () => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = withFileMutation(file, async () => {
      started()
      await gate
      throw new Error('failure')
    }).catch(() => {})
    await ready
    const writer = writeTextFile(file, 'replacement')
    expect(await readFile(file, 'utf8')).toBe('alpha\nbeta\n')
    release()
    await Promise.all([first, writer])
    expect(await readFile(file, 'utf8')).toBe('replacement')
  })
})
