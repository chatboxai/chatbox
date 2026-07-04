import { tool } from 'ai'
import z from 'zod'
import { MAX_INLINE_FILE_LINES, PREVIEW_LINES } from '@/packages/context-management/attachment-payload'
import platform from '@/platform'

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

const readFileTool = tool({
  description: 'Reads the content of a file uploaded by the user.',
  inputSchema: z.object({
    fileKey: z.string().describe('The identifier of the file to read within tag `<FILE_KEY>`.'),
    lineOffset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Optional line offset to start reading from. Defaults to 0.'),
    maxLines: z
      .number()
      .int()
      .min(1)
      .max(MAX_LINES)
      .default(DEFAULT_LINES)
      .optional()
      .describe(`Optional maximum number of lines to read. Defaults to ${DEFAULT_LINES}.`),
  }),
  execute: async (
    input: { fileKey: string; lineOffset?: number; maxLines?: number },
    _context: { abortSignal?: AbortSignal }
  ) => {
    const fileContent = await readFileContentFromKey(input.fileKey)
    if (fileContent === null) {
      throw new Error(
        'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
      )
    }
    const lines = fileContent.split('\n')
    const lineOffset = input.lineOffset ?? 0
    const maxLines = input.maxLines ?? DEFAULT_LINES
    const selectedLines = lines.slice(lineOffset, lineOffset + maxLines)
    const truncatedLines = selectedLines.map(truncateLine)
    const numberedLines = truncatedLines.map((line, index) => formatLineWithNumber(line, lineOffset + index + 1))
    return {
      fileKey: input.fileKey,
      content: numberedLines.join('\n'),
      lineOffset,
      linesRead: selectedLines.length,
      totalLines: lines.length,
    }
  },
})

const searchFileTool = tool({
  description: 'Searches for a keyword or phrase within a file uploaded by the user.',
  inputSchema: z.object({
    fileKey: z.string().describe('The identifier of the file to read within tag `<FILE_KEY>`.'),
    query: z.string().describe('The keyword or phrase to search for within the file.'),
    beforeContextLines: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Optional number of context lines to include before each match. Defaults to 0.'),
    afterContextLines: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Optional number of context lines to include after each match. Defaults to 0.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(GREP_MAX_RESULTS)
      .default(10)
      .optional()
      .describe('Optional maximum number of results to return. Defaults to 10.'),
  }),
  execute: async (
    input: {
      fileKey: string
      query: string
      beforeContextLines?: number
      afterContextLines?: number
      maxResults?: number
    },
    _context: { abortSignal?: AbortSignal }
  ) => {
    const fileContent = await readFileContentFromKey(input.fileKey)
    if (fileContent === null) {
      throw new Error(
        'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
      )
    }
    const lines = fileContent.split('\n')
    const results: Array<{ lineNumber: number; lineContent: string; context: string[] }> = []

    const beforeLines = input.beforeContextLines ?? 0
    const afterLines = input.afterContextLines ?? 0
    const maxResults = input.maxResults ?? 10

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(input.query)) {
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
      fileKey: input.fileKey,
      query: input.query,
      results,
      totalMatches: results.length,
    }
  },
})

export default {
  description: toolSetDescription,
  tools: {
    read_file: readFileTool,
    search_file_content: searchFileTool,
  },
}
