import { constants as fsConstants, type Stats } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import {
  WORKSPACE_INSTRUCTIONS_MAX_CHARS,
  WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES,
  type WorkspaceInstructionFile,
  type WorkspaceInstructionsResult,
} from '../shared/types/workspace-instructions'
import { isUnsafeResolvedPath } from './sandbox/path-safety'

const WORKSPACE_INSTRUCTION_FILENAMES = ['AGENTS.md', 'agents.md'] as const

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * On Windows, libuv may report `st_dev` as 0 for a path-based stat while a handle-based
 * fstat reports the volume serial number, so identity there relies on the NTFS file ID.
 * File systems without file IDs (exFAT, some network shares) report `ino` 0, which cannot
 * prove identity and is rejected.
 */
export function isSameFileIdentity(pathStat: Stats, handleStat: Stats, platform = process.platform): boolean {
  if (pathStat.ino !== handleStat.ino) return false
  if (platform === 'win32') return handleStat.ino !== 0
  return pathStat.dev === handleStat.dev
}

const reportedRejections = new Set<string>()

// Instructions are reloaded every turn, so each file/reason pair is logged once per process.
function rejectInstructionFile(filePath: string, reason: string): null {
  const key = `${filePath}\0${reason}`
  if (!reportedRejections.has(key)) {
    reportedRejections.add(key)
    log.warn(`[workspace-instructions] skipped ${filePath}: ${reason}`)
  }
  return null
}

function pathKey(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

async function resolveSafeWorkspaceDirectory(directory: string): Promise<{
  selectedRoot: string
  canonicalRoot: string
} | null> {
  if (!path.isAbsolute(directory)) return null

  try {
    const selectedRoot = path.resolve(directory)
    const canonicalRoot = await realpath(selectedRoot)
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) return null
    if (isUnsafeResolvedPath(selectedRoot) || isUnsafeResolvedPath(canonicalRoot)) return null
    return { selectedRoot, canonicalRoot }
  } catch {
    return null
  }
}

async function readInstructionFile(
  filePath: string,
  canonicalRoot: string,
  remainingChars: number
): Promise<WorkspaceInstructionFile | null> {
  if (remainingChars <= 0) return null

  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    let fileLstat: Stats
    try {
      fileLstat = await lstat(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (fileLstat.isSymbolicLink()) return rejectInstructionFile(filePath, 'symbolic links are not followed')
    if (!fileLstat.isFile()) return rejectInstructionFile(filePath, 'not a regular file')

    const canonicalFile = await realpath(filePath)
    if (!pathContains(canonicalRoot, canonicalFile)) {
      return rejectInstructionFile(filePath, 'resolves outside the workspace')
    }

    const noFollowFlag = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
    fileHandle = await open(filePath, fsConstants.O_RDONLY | noFollowFlag)
    const fileStat = await fileHandle.stat()
    if (!fileStat.isFile()) return rejectInstructionFile(filePath, 'opened handle is not a regular file')
    const canonicalFileAfterOpen = await realpath(filePath)
    if (!pathContains(canonicalRoot, canonicalFileAfterOpen)) {
      return rejectInstructionFile(filePath, 'resolves outside the workspace after open')
    }
    const pathStat = await stat(canonicalFileAfterOpen)
    if (!isSameFileIdentity(pathStat, fileStat)) {
      return rejectInstructionFile(filePath, 'file identity could not be verified after open')
    }

    // Read a bounded byte prefix. Four bytes per remaining UTF-16 code unit covers the
    // longest UTF-8 encoding while keeping large instruction files out of memory.
    const maxBytes = remainingChars * 4 + 4
    const bytesToRead = Math.min(fileStat.size, maxBytes)
    if (bytesToRead === 0) return { filePath, content: '', truncated: false }

    const buffer = new Uint8Array(bytesToRead)
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
    const decoded = new TextDecoder().decode(buffer.subarray(0, bytesRead))
    const content = decoded.slice(0, remainingChars)
    return {
      filePath,
      content,
      truncated: fileStat.size > bytesRead || decoded.length > remainingChars,
    }
  } catch (error) {
    return rejectInstructionFile(filePath, error instanceof Error ? error.message : String(error))
  } finally {
    await fileHandle?.close().catch(() => undefined)
  }
}

export async function loadWorkspaceInstructions(directories: string[]): Promise<WorkspaceInstructionsResult> {
  const requestedDirectories = directories.map((directory) => directory.trim()).filter(Boolean)
  const uniqueDirectories = requestedDirectories.filter(
    (directory, index) =>
      requestedDirectories.findIndex((candidate) => pathKey(candidate) === pathKey(directory)) === index
  )
  const limitedDirectories = uniqueDirectories.slice(0, WORKSPACE_INSTRUCTIONS_MAX_DIRECTORIES)
  const result: WorkspaceInstructionsResult = {
    directories: [],
    files: [],
    skippedDirectoryCount: uniqueDirectories.length - limitedDirectories.length,
    budgetExhausted: false,
  }
  let remainingChars = WORKSPACE_INSTRUCTIONS_MAX_CHARS

  for (const [index, directory] of limitedDirectories.entries()) {
    const safeDirectory = await resolveSafeWorkspaceDirectory(directory)
    if (!safeDirectory) {
      result.skippedDirectoryCount += 1
      continue
    }

    result.directories.push(safeDirectory.selectedRoot)
    if (remainingChars <= 0) {
      result.budgetExhausted = true
      continue
    }

    for (const fileName of WORKSPACE_INSTRUCTION_FILENAMES) {
      const filePath = path.join(safeDirectory.selectedRoot, fileName)
      const instructionFile = await readInstructionFile(filePath, safeDirectory.canonicalRoot, remainingChars)
      if (!instructionFile) continue
      if (instructionFile.content.trim().length > 0) {
        result.files.push(instructionFile)
        remainingChars -= instructionFile.content.length
      }
      if (instructionFile.truncated) result.budgetExhausted = true
      break
    }

    if (remainingChars <= 0 && index < limitedDirectories.length - 1) {
      result.budgetExhausted = true
    }
  }

  return result
}
