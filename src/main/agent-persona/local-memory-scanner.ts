import { promises as fs, type Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LOCAL_MEMORY_IMPORT_MAX_CANDIDATES,
  type LocalMemoryCandidate,
  type LocalMemoryScanResult,
  type LocalMemorySource,
  MEMORY_IMPORT_MAX_FILE_BYTES,
  parseMemoryImport,
} from '../../shared/agent-persona/memory-import'
import { MEMORY_ENTRY_MAX_CHARS } from '../../shared/types/agent-persona'

interface SourceFile {
  source: LocalMemorySource
  filePath: string
}

async function isReadableMemoryFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath)
    return stat.isFile() && stat.size <= MEMORY_IMPORT_MAX_FILE_BYTES
  } catch {
    return false
  }
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(entryPath)))
    } else if (entry.isFile() && /\.md$/i.test(entry.name) && (await isReadableMemoryFile(entryPath))) {
      files.push(entryPath)
    }
  }
  return files
}

async function findClaudeUserMemoryFiles(homeDirectory: string): Promise<SourceFile[]> {
  const claudeDirectory = path.join(homeDirectory, '.claude')
  const files: SourceFile[] = []
  const userInstructions = path.join(claudeDirectory, 'CLAUDE.md')
  if (await isReadableMemoryFile(userInstructions)) files.push({ source: 'claude', filePath: userInstructions })
  for (const filePath of await findMarkdownFiles(path.join(claudeDirectory, 'rules'))) {
    files.push({ source: 'claude', filePath })
  }
  return files
}

async function findSourceFiles(homeDirectory: string): Promise<SourceFile[]> {
  const codexFile = path.join(homeDirectory, '.codex', 'memories', 'memory_summary.md')
  const files: SourceFile[] = []
  if (await isReadableMemoryFile(codexFile)) files.push({ source: 'codex', filePath: codexFile })
  files.push(...(await findClaudeUserMemoryFiles(homeDirectory)))
  return files
}

function displayPath(homeDirectory: string, filePath: string): string {
  const relative = path.relative(homeDirectory, filePath)
  return relative && !relative.startsWith('..') ? path.join('~', relative) : filePath
}

export async function scanLocalMemoryCandidates(homeDirectory = os.homedir()): Promise<LocalMemoryScanResult> {
  const files = await findSourceFiles(homeDirectory)
  const candidates: LocalMemoryCandidate[] = []
  const seen = new Set<string>()
  let skippedFiles = 0

  for (const file of files) {
    try {
      const parsed = parseMemoryImport(path.basename(file.filePath), await fs.readFile(file.filePath, 'utf8'))
      if (!parsed.ok) {
        skippedFiles += 1
        continue
      }
      for (const content of parsed.entries) {
        if (content.length > MEMORY_ENTRY_MAX_CHARS || seen.has(content)) continue
        seen.add(content)
        candidates.push({
          id: `${file.source}:${file.filePath}:${candidates.length}`,
          source: file.source,
          displayPath: displayPath(homeDirectory, file.filePath),
          content,
        })
        if (candidates.length >= LOCAL_MEMORY_IMPORT_MAX_CANDIDATES) return { candidates, skippedFiles }
      }
    } catch {
      skippedFiles += 1
    }
  }

  return { candidates, skippedFiles }
}
