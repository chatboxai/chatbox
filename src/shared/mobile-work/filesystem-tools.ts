import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { throwIfWorkAborted } from './abort'
import type { LocalWorkspacePort } from './workspace-port'
import { textToBase64, workspacePath } from './workspace-path'

const directory = (path: string) => (path === '.' || path === '' ? '' : `${workspacePath(path.replace(/\/$/, ''))}/`)
const listInput = z.object({ path: z.string().max(240).default('.') }).strict()
const readInput = z
  .object({
    path: z.string(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20_000).default(8000),
  })
  .strict()
const editInput = z
  .object({
    file_path: z.string(),
    edits: z
      .array(z.object({ old_text: z.string().min(1).max(100_000), new_text: z.string().max(100_000) }).strict())
      .min(1)
      .max(50),
  })
  .strict()
const searchInput = z
  .object({
    path: z.string().max(240).default('.'),
    query: z.string().min(1).max(1000),
    include: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

function readText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/[\u0000-\u0008\u000e-\u001f]/.test(value)) throw new Error('Binary content')
    return value
  } catch {
    throw new Error(
      'File is not UTF-8 text. Use view_image for images or load_skill for supported document processing.'
    )
  }
}

/** Literal matching with a small glob vocabulary; user patterns never become regular expressions. */
function matchesName(name: string, pattern: string): boolean {
  let n = 0,
    p = 0,
    star = -1,
    retry = 0
  while (n < name.length) {
    if (pattern[p] === '?' || pattern[p] === name[n]) {
      n++
      p++
    } else if (pattern[p] === '*') {
      star = p++
      retry = n
    } else if (star >= 0) {
      p = star + 1
      n = ++retry
    } else return false
  }
  while (pattern[p] === '*') p++
  return p === pattern.length
}

export function buildLocalFilesystemTools(
  workspace: LocalWorkspacePort,
  context: { sessionId: string; signal: AbortSignal }
): ToolSet {
  return {
    list_files: tool({
      description:
        'List session workspace files recursively, optionally under a relative directory path. Use . for the workspace root.',
      inputSchema: listInput,
      execute: async (input) => {
        const prefix = directory(listInput.parse(input).path)
        throwIfWorkAborted(context.signal)
        const files = await workspace.snapshot(context.sessionId)
        return Object.entries(files)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, file]) => ({
            path,
            bytes: (file.base64.length * 3) / 4 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0),
          }))
      },
    }),
    read_file: tool({
      description:
        'Read UTF-8 text from a workspace file. offset is a zero-based character offset, limit is characters. Binary files require image or document tools.',
      inputSchema: readInput,
      execute: async (input) => {
        const { path, offset, limit } = readInput.parse(input)
        workspacePath(path)
        throwIfWorkAborted(context.signal)
        const text = readText(await workspace.readBase64(context.sessionId, path))
        return { text: text.slice(offset, offset + limit), totalCharacters: text.length }
      },
    }),
    edit_file: tool({
      description:
        'Apply ordered exact text replacements to a UTF-8 workspace file. Each old_text must match exactly once. All edits succeed together; input attachments and delivered artifacts are read-only.',
      inputSchema: editInput,
      execute: async (input, options) => {
        const { file_path, edits } = editInput.parse(input)
        workspacePath(file_path)
        if (file_path.startsWith('input/') || file_path.startsWith('artifacts/'))
          throw new Error('Input attachments and delivered files are read-only')
        const signal = options.abortSignal ?? context.signal
        throwIfWorkAborted(signal)
        let text = readText(await workspace.readBase64(context.sessionId, file_path))
        for (const [index, edit] of edits.entries()) {
          const position = text.indexOf(edit.old_text)
          if (position < 0) throw new Error(`Edit ${index + 1}: search text not found`)
          if (text.indexOf(edit.old_text, position + 1) >= 0)
            throw new Error(`Edit ${index + 1}: search text is not unique`)
          text = text.slice(0, position) + edit.new_text + text.slice(position + edit.old_text.length)
        }
        throwIfWorkAborted(signal)
        await workspace.commit(context.sessionId, { [file_path]: { base64: textToBase64(text) } }, signal)
        return { success: true, file_path, edits: edits.length }
      },
    }),
    search_files: tool({
      description:
        'Search UTF-8 workspace file contents for literal case-sensitive text. Optional include filters base filenames with * and ?. Returns bounded line previews; binary files are skipped. No regex matching.',
      inputSchema: searchInput,
      execute: async (input) => {
        const { path, query, include, limit } = searchInput.parse(input)
        const prefix = directory(path)
        throwIfWorkAborted(context.signal)
        const files = await workspace.snapshot(context.sessionId)
        const matches: { path: string; line: number; preview: string }[] = []
        let skippedBinary = 0
        for (const [filePath, file] of Object.entries(files)) {
          throwIfWorkAborted(context.signal)
          if (!filePath.startsWith(prefix) || (include && !matchesName(filePath.split('/').pop() ?? '', include)))
            continue
          let text: string
          try {
            text = readText(file.base64)
          } catch {
            skippedBinary++
            continue
          }
          let offset = 0,
            line = 1
          while (offset <= text.length) {
            const newline = text.indexOf('\n', offset)
            const end = newline < 0 ? text.length : newline
            const lineText = text.slice(offset, end)
            const relativeMatch = lineText.indexOf(query)
            const found = relativeMatch < 0 ? -1 : offset + relativeMatch
            if (found >= offset && found < end && found + query.length <= end) {
              if (matches.length === limit) return { matches, truncated: true, skippedBinary }
              matches.push({
                path: filePath,
                line,
                preview: text.slice(Math.max(offset, found - 80), Math.min(end, found + 160)),
              })
            }
            if (newline < 0) break
            offset = newline + 1
            line++
          }
        }
        return { matches, truncated: false, skippedBinary }
      },
    }),
  }
}
