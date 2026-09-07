import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
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
    const fileLstat = await lstat(filePath)
    if (!fileLstat.isFile() || fileLstat.isSymbolicLink()) return null

    const canonicalFile = await realpath(filePath)
    if (!pathContains(canonicalRoot, canonicalFile)) return null

    const noFollowFlag = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
    fileHandle = await open(filePath, fsConstants.O_RDONLY | noFollowFlag)
    const fileStat = await fileHandle.stat()
    if (!fileStat.isFile()) return null
    const canonicalFileAfterOpen = await realpath(filePath)
    if (!pathContains(canonicalRoot, canonicalFileAfterOpen)) return null
    const pathStat = await stat(canonicalFileAfterOpen)
    if (pathStat.dev !== fileStat.dev || pathStat.ino !== fileStat.ino) return null

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
  } catch {
    return null
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
