import { jsonSchema, type ToolSet } from 'ai'
import { MAX_INLINE_FILE_LINES, PREVIEW_LINES } from '@shared/constants'
import platform from '@/platform'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'

const DEFAULT_LINES = 200
const MAX_LINES = MAX_INLINE_FILE_LINES
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
  const lineOffset = numberField(record, 'lineOffset')
  if (linesRead === undefined || totalLines === undefined || lineOffset === undefined) return content
  const nextOffset = lineOffset + linesRead
  return nextOffset < totalLines
    ? `${content}\n\n[${totalLines - nextOffset} more lines. Use lineOffset=${nextOffset} to continue.]`
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

const toolSetDescription = `
Use these tools to read and search large user-uploaded files (marked with <ATTACHMENT_FILE></ATTACHMENT_FILE>).

IMPORTANT:
- Files with ≤${MAX_LINES} lines have their FULL content in <FILE_CONTENT> tags - read them directly without tools.
- Files with >${MAX_LINES} lines only show the first ${PREVIEW_LINES} lines as preview in <FILE_CONTENT>, with a <TRUNCATED> tag indicating more content is available. Use these tools to read additional content beyond the preview.

## read_file
Reads file content with line numbers (like \`cat -n\`).
- Returns up to ${DEFAULT_LINES} lines by default, max ${MAX_LINES} lines per call
- Lines exceeding ${MAX_LINE_LENGTH} characters are truncated with "..."
- Use \`lineOffset\` and \`maxLines\` to read specific portions
- Prefer \`search_file_content\` when searching for specific content
- Call in parallel when reading multiple files

## search_file_content
Searches for text patterns within a file.
- Returns matching lines with line numbers and optional context
- Use \`beforeContextLines\` / \`afterContextLines\` to include surrounding lines
- Returns up to ${GREP_MAX_RESULTS} matches maximum
- Call in parallel when searching multiple files
`

const readFileTool: ToolSet[string] = {
  description: 'Reads the content of a file uploaded by the user.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      fileKey: {
        type: 'string',
        description: 'The identifier of the file to read within tag `<FILE_KEY>`.',
      },
      lineOffset: {
        type: 'integer',
        minimum: 0,
        description: 'Optional line offset to start reading from. Defaults to 0.',
      },
      maxLines: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LINES,
        default: DEFAULT_LINES,
        description: `Optional maximum number of lines to read. Defaults to ${DEFAULT_LINES}.`,
      },
    },
    required: ['fileKey'],
    additionalProperties: false,
  }),
  execute: async (input) => {
    const readInput = input as { fileKey: string; lineOffset?: number; maxLines?: number }
    const fileContent = await readFileContentFromKey(readInput.fileKey)
    if (fileContent === null) {
      return 'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
    }
    const lines = fileContent.split('\n')
    const lineOffset = Math.max(0, Math.floor(readInput.lineOffset ?? 0))
    const maxLines = Math.max(1, Math.min(Math.floor(readInput.maxLines ?? DEFAULT_LINES), MAX_LINES))
    const selectedLines = lines.slice(lineOffset, lineOffset + maxLines)
    const truncatedLines = selectedLines.map(truncateLine)
    const numberedLines = truncatedLines.map((line, index) => formatLineWithNumber(line, lineOffset + index + 1))
    return {
      fileKey: readInput.fileKey,
      content: numberedLines.join('\n'),
      lineOffset,
      linesRead: selectedLines.length,
      totalLines: lines.length,
    }
  },
  toModelOutput: toTextModelOutput(formatUploadedFileReadOutput, { emptyFallback: 'File is empty.' }),
}

const searchFileTool: ToolSet[string] = {
  description: 'Searches for a keyword or phrase within a file uploaded by the user.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      fileKey: {
        type: 'string',
        description: 'The identifier of the file to read within tag `<FILE_KEY>`.',
      },
      query: {
        type: 'string',
        description: 'The keyword or phrase to search for within the file.',
      },
      beforeContextLines: {
        type: 'integer',
        minimum: 0,
        description: 'Optional number of context lines to include before each match. Defaults to 0.',
      },
      afterContextLines: {
        type: 'integer',
        minimum: 0,
        description: 'Optional number of context lines to include after each match. Defaults to 0.',
      },
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: GREP_MAX_RESULTS,
        default: 10,
        description: 'Optional maximum number of results to return. Defaults to 10.',
      },
    },
    required: ['fileKey', 'query'],
    additionalProperties: false,
  }),
  execute: async (input) => {
    const searchInput = input as {
      fileKey: string
      query: string
      beforeContextLines?: number
      afterContextLines?: number
      maxResults?: number
    }
    const fileContent = await readFileContentFromKey(searchInput.fileKey)
    if (fileContent === null) {
      return 'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
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
      fileKey: searchInput.fileKey,
      query: searchInput.query,
      results,
      totalMatches: results.length,
    }
  },
  toModelOutput: toTextModelOutput(formatUploadedFileSearchOutput),
}

export default {
  description: toolSetDescription,
  tools: {
    read_file: readFileTool,
    search_file_content: searchFileTool,
  },
}
