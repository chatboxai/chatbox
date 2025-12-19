import { tool } from 'ai'
import z from 'zod'
import platform from '@/platform'

const DEFAULT_LINES = 200
const MAX_LINES = 500
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

const toolSetDescription = `
Two tools are provided to interact with files uploaded by the user.
Make sure you follow the description of each tool parameter.

read_file:
Read file content from the given file name

Content will be returned with a line number before each line like cat -n format.
Use lineOffset and maxLines parameters when you only need to read a part of the file.
The maximum number of lines that can be read at once is ${MAX_LINES}, default is ${DEFAULT_LINES}, prevent excessive memory usage.
Any lines longer than ${MAX_LINE_LENGTH} characters will be truncated, ending with "...".
This tool is a tool that you typically want to use in parallel. Always read multiple files in one response when possible.
If the file doesn't exist, an error will be returned.
If you want to search for a certain content/pattern, prefer grepFile tool over readFile.

grep_file:
Searches for a keyword or phrase within a file uploaded by the user.

For each match, the line number, line content, and surrounding context lines will be returned.
Use beforeContextLines and afterContextLines to specify how many context lines to include.
The maximum number of results that can be returned at once is ${GREP_MAX_RESULTS}.
This tool is a tool that you typically want to use in parallel. Always search multiple files in one response when possible.
If the file doesn't exist, an error will be returned.
`

const readFileTool = tool({
  description: 'Reads the content of a file uploaded by the user.',
  inputSchema: z.object({
    fileName: z.string().describe('The identifier of the file to read.'),
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
    input: { fileName: string; lineOffset?: number; maxLines?: number },
    _context: { abortSignal?: AbortSignal }
  ) => {
    const fileContent = (await platform.getStoreBlob(input.fileName)) || ''
    const lines = fileContent.split('\n')
    const lineOffset = input.lineOffset ?? 0
    const maxLines = input.maxLines ?? DEFAULT_LINES
    const selectedLines = lines.slice(lineOffset, lineOffset + maxLines)
    const truncatedLines = selectedLines.map(truncateLine)
    const numberedLines = truncatedLines.map((line, index) => formatLineWithNumber(line, lineOffset + index + 1))
    return {
      fileName: input.fileName,
      content: numberedLines.join('\n'),
      lineOffset,
      linesRead: selectedLines.length,
      totalLines: lines.length,
    }
  },
})

const grepFileTool = tool({
  description: 'Searches for a keyword or phrase within a file uploaded by the user.',
  inputSchema: z.object({
    fileName: z.string().describe('The identifier of the file to search.'),
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
      fileName: string
      query: string
      beforeContextLines?: number
      afterContextLines?: number
      maxResults?: number
    },
    _context: { abortSignal?: AbortSignal }
  ) => {
    const fileContent = (await platform.getStoreBlob(input.fileName)) || ''
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
      fileName: input.fileName,
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
    grep_file: grepFileTool,
  },
}
