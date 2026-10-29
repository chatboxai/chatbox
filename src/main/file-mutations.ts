import { createHash } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { summarizeFileEdit } from '../shared/file-edit-summary'
import {
  applyTextEdits,
  type FileEditError,
  type FileEditRequest,
  type FileEditResult,
  fileEditError,
  MAX_EDIT_FILE_BYTES,
} from '../shared/file-edits'

import { readRegularFileBytesBounded } from './bounded-file-read'

const pending = new Map<string, Promise<void>>()

/** Coordinates this process's write/edit calls, including symlink aliases. */
export async function withFileMutation<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(filePath)
  const key = await realpath(resolved).catch(async () => {
    const parent = await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved))
    return path.join(parent, path.basename(resolved))
  })
  const previous = pending.get(key) ?? Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  pending.set(key, tail)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (pending.get(key) === tail) pending.delete(key)
  }
}

function version(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function readEditFile(filePath: string): Promise<string | FileEditError> {
  try {
    const result = await readRegularFileBytesBounded(filePath, MAX_EDIT_FILE_BYTES)
    if (!result.success) return fileEditError(result.reason === 'too-large' ? 'FILE_TOO_LARGE' : 'NOT_REGULAR_FILE')
    return result.bytes.toString('utf8')
  } catch (error) {
    return fileEditError(
      error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'READ_FAILED'
    )
  }
}

export function editTextFile(request: FileEditRequest): Promise<FileEditResult> {
  return withFileMutation(request.filePath, async () => {
    try {
      const before = await readEditFile(request.filePath)
      if (typeof before !== 'string') return before
      const currentVersion = version(before)
      if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
        return fileEditError('STALE_CONTENT')
      }
      const edits = request.edits?.length
        ? request.edits
        : request.search !== undefined && request.replace !== undefined
          ? [{ search: request.search, replace: request.replace }]
          : []
      const result = applyTextEdits(before, edits)
      if (!result.success) return result
      const summary = summarizeFileEdit(before, result.content, edits.length)
      if (!request.dryRun && summary.changed) {
        // Detect intervening external changes; this is not an OS-level CAS.
        const latest = await readEditFile(request.filePath)
        if (typeof latest !== 'string') return latest
        if (version(latest) !== currentVersion) {
          return fileEditError('STALE_CONTENT')
        }
        await writeFile(request.filePath, result.content, 'utf8')
      }
      return { ...summary, version: request.dryRun ? currentVersion : version(result.content) }
    } catch {
      return fileEditError('WRITE_FAILED')
    }
  })
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await withFileMutation(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  })
}
