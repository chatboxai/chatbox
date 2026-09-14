import type { Message } from '@shared/types'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import {
  readFileSchema,
  uploadedFileSearchSchema,
  uploadedFilePath,
  isUploadedFilePath,
  READ_FILE_DEFAULT_LINES,
  READ_FILE_MAX_LINES,
} from '@shared/uploaded-file-tools'
import type { ToolSet } from 'ai'
import platform from '@/platform'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'

const DEFAULT_LINES = READ_FILE_DEFAULT_LINES
const MAX_LINES = READ_FILE_MAX_LINES
const MAX_LINE_LENGTH = 2000

const truncateLine = (line: string) => {
  if (line.length <= MAX_LINE_LENGTH) {
    return line
  }

  if (MAX_LINE_LENGTH <= 3) {
    return line.slice(0, MAX_LINE_LENGTH)
  }

  return `${line.slice(0, MAX_LINE_LENGTH - 3)}...`
}

const formatLineWithNumber = (line: string, lineNumber: number) => {
  const lineNumberStr = String(lineNumber).padStart(6, ' ')
  return `${lineNumberStr}\t${line}`
}

const GREP_MAX_RESULTS = 100

function formatUploadedFileReadOutput(output: unknown): string {
  const content = contentOrErrorText(output)
  const record = asRecord(output)
  const linesRead = numberField(record, 'linesRead')
  const totalLines = numberField(record, 'totalLines')
  const offset = numberField(record, 'offset')
  if (linesRead === undefined || totalLines === undefined || offset === undefined) return content
  if (offset > totalLines)
    return `Offset ${offset} exceeds the file's ${totalLines} total lines. Use an offset between 1 and ${totalLines}.`
  const nextOffset = offset + linesRead
  return nextOffset <= totalLines
    ? `${content}\n\n[${totalLines - nextOffset + 1} more lines. Use offset=${nextOffset} to continue.]`
    : content
}

function formatUploadedFileSearchOutput(output: unknown): string {
  if (typeof output === 'string') return output
  const record = asRecord(output)
  const query = stringField(record, 'query')
  const results = record?.results
  if (!Array.isArray(results)) return contentOrErrorText(output)
  if (results.length === 0) return query ? `No matches found for "${query}".` : 'No matches found.'
  return results
    .map((item) => {
      const result = asRecord(item)
      const lineNumber = numberField(result, 'lineNumber')
      const lineContent = stringField(result, 'lineContent') ?? ''
      const context = result?.context
      if (Array.isArray(context) && context.every((line) => typeof line === 'string')) {
        return `Line ${lineNumber ?? '?'}:\n${context.join('\n')}`
      }
      return `Line ${lineNumber ?? '?'}: ${lineContent}`
    })
    .join('\n\n')
}

async function readFileContentFromKey(fileKey: string): Promise<string | null> {
  if (fileKey.startsWith('local:')) {
    const localPath = fileKey.slice('local:'.length)
    if (!platform.readLocalFileContent) {
      return null
    }
    return platform.readLocalFileContent(localPath)
  }
  return platform.getStoreBlob(fileKey)
}

export const fileToolSetDescription = `
Uploaded content referenced by <FILE_PATH> has a read-only virtual path. Use the path exactly as provided.
Commands require filesystem paths; use <SANDBOX_PATH> or <PARSED_SANDBOX_PATH> when supplied.
Read requested text directly from <FILE_CONTENT> when present. A <TRUNCATED> marker means more content is available through read_file.

## read_file
Reads file content with line numbers (like \`cat -n\`).
- Returns up to ${DEFAULT_LINES} lines by default, max ${MAX_LINES} lines per call
- Lines exceeding ${MAX_LINE_LENGTH} characters are truncated with "..."
- Use \`offset\` and \`limit\` to read specific portions
- For virtual paths in <FILE_PATH>, prefer \`search_file_content\` when searching for specific content
- Call in parallel when reading multiple files

## search_file_content
Searches for text patterns in virtual uploaded content identified by <FILE_PATH>.
- Returns matching lines with line numbers and optional context
- Use \`beforeContextLines\` / \`afterContextLines\` to include surrounding lines
- Returns up to ${GREP_MAX_RESULTS} matches maximum
- Call in parallel when searching multiple files
`

export function buildFileTools(
  messages: Message[],
  filesystemRead?: ToolSet[string],
  loadFileMessages?: () => Promise<Message[]>
) {
  const files = new Map<string, string>()
  const add = (key: string) => files.set(uploadedFilePath(key), key)
  const register = (messages: Message[]) => {
    for (const message of messages) {
      for (const file of message.files ?? []) {
        if (file.ragMode === 'session-retrieval') continue
        if (file.storageKey) add(file.storageKey)
        else if (file.localPath) add(`local:${file.localPath}`)
      }
      for (const link of message.links ?? []) if (link.storageKey) add(link.storageKey)
      for (const part of message.contentParts ?? []) {
        if (part.type === 'tool-call' && part.resultStorageKey) add(part.resultStorageKey)
      }
    }
  }
  register(messages)
  let historyRead: Promise<void> | undefined
  const readContent = async (path: string) => {
    if (!isUploadedFilePath(path)) return null
    if (!files.has(path) && loadFileMessages) {
      try {
        historyRead ??= Promise.resolve().then(loadFileMessages).then(register)
        await historyRead
      } catch {
        historyRead = undefined
        return null
      }
    }
    const key = files.get(path)
    return key === undefined ? null : readFileContentFromKey(key)
  }
  const readFileTool: ToolSet[string] = {
    description: `${filesystemRead?.description ?? 'Read file content.'} Uploaded files use the read-only virtual path in <FILE_PATH>. Use offset (1-based) and limit for line ranges.`,
    inputSchema: validatedToolSchema(readFileSchema),
    execute: async (input, options) => {
      const readInput = input as { file_path: string; offset?: number; limit?: number }
      if (!isUploadedFilePath(readInput.file_path) && filesystemRead?.execute) {
        return filesystemRead.execute(input, options)
      }
      const fileContent = await readContent(readInput.file_path)
      if (fileContent === null) {
        return 'File not found or inaccessible. Copy the file_path from <FILE_PATH> in this conversation.'
      }
      const lines = fileContent.split('\n')
      const offset = Math.max(1, Math.floor(readInput.offset ?? 1))
      const limit = Math.max(1, Math.min(Math.floor(readInput.limit ?? DEFAULT_LINES), MAX_LINES))
      const selectedLines = lines.slice(offset - 1, offset - 1 + limit)
      const truncatedLines = selectedLines.map(truncateLine)
      const numberedLines = truncatedLines.map((line, index) => formatLineWithNumber(line, offset + index))
      return {
        file_path: readInput.file_path,
        content: numberedLines.join('\n'),
        offset,
        linesRead: selectedLines.length,
        totalLines: lines.length,
      }
    },
    toModelOutput: async (options: { toolCallId: string; input: unknown; output: unknown }) => {
      const input = options.input as { file_path: string }
      if (!isUploadedFilePath(input.file_path) && filesystemRead?.toModelOutput)
        return filesystemRead.toModelOutput(options)
      return toTextModelOutput(formatUploadedFileReadOutput, { emptyFallback: 'File is empty.' })(options)
    },
  }

  const searchFileTool: ToolSet[string] = {
    description:
      'Search a keyword or phrase in uploaded content using the virtual path from <FILE_PATH>. For sandbox files use search_files or a command.',
    inputSchema: validatedToolSchema(uploadedFileSearchSchema),
    execute: async (input) => {
      const searchInput = input as {
        file_path: string
        query: string
        beforeContextLines?: number
        afterContextLines?: number
        maxResults?: number
      }
      const fileContent = await readContent(searchInput.file_path)
      if (fileContent === null) {
        return 'File not found or inaccessible. Copy the file_path from <FILE_PATH> in this conversation.'
      }
      const lines = fileContent.split('\n')
      const results: Array<{ lineNumber: number; lineContent: string; context: string[] }> = []

      const beforeLines = searchInput.beforeContextLines ?? 0
      const afterLines = searchInput.afterContextLines ?? 0
      const maxResults = searchInput.maxResults ?? 10

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchInput.query)) {
          const contextStart = Math.max(0, i - beforeLines)
          const contextEnd = Math.min(lines.length, i + afterLines + 1)
          const context = lines.slice(contextStart, contextEnd).map(truncateLine)
          results.push({ lineNumber: i + 1, lineContent: truncateLine(lines[i]), context })
          if (results.length >= maxResults) {
            break
          }
        }
      }

      return {
        file_path: searchInput.file_path,
        query: searchInput.query,
        results,
        totalMatches: results.length,
      }
    },
    toModelOutput: toTextModelOutput(formatUploadedFileSearchOutput),
  }

  return {
    description: fileToolSetDescription,
    tools: {
      read_file: readFileTool,
      search_file_content: searchFileTool,
    },
  }
}
