export const SANDBOX_READ_MAX_CONTENT_BYTES = 45_000

interface BuildSandboxReadScriptOptions {
  filePath: string
  startLine: number
  limit: number
  maxLineLength: number
}

/**
 * Build the Node program used to read sandbox files.
 *
 * The program writes one JSON object to stdout. Keep the encoded content below the generic
 * execCode 50KB truncation threshold; otherwise execCode would decorate the output with a
 * truncation notice and make the JSON invalid. The reader still scans to EOF so totalLines
 * remains exact, but stops collecting content once the byte budget is exhausted.
 */
export function buildSandboxReadScript(options: BuildSandboxReadScriptOptions): string {
  return `
const fs = require('fs')
const readline = require('readline')
const filePath = ${JSON.stringify(options.filePath)}
const startLine = ${options.startLine}
const limit = ${options.limit}
const maxLineLength = ${options.maxLineLength}
const maxContentBytes = ${SANDBOX_READ_MAX_CONTENT_BYTES}
const selected = []
let selectedBytes = 0
let selectionFull = false
let totalLines = 0
let truncatedLineCount = 0

const input = fs.createReadStream(filePath, { encoding: 'utf8' })
const lines = readline.createInterface({ input, crlfDelay: Infinity })

;(async () => {
  for await (const line of lines) {
    totalLines++
    if (totalLines >= startLine && selected.length < limit && !selectionFull) {
      const candidate = line.length > maxLineLength ? line.slice(0, maxLineLength - 3) + '...' : line
      // JSON.stringify includes the surrounding quotes. Subtract those two bytes, then account
      // for the escaped newline separator that selected.join('\\n') adds between lines.
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8') - 2
      const separatorBytes = selected.length > 0 ? 2 : 0
      if (selectedBytes + separatorBytes + candidateBytes > maxContentBytes) {
        selectionFull = true
      } else {
        selected.push(candidate)
        if (line.length > maxLineLength) truncatedLineCount++
        selectedBytes += separatorBytes + candidateBytes
      }
    }
  }
  if (startLine > totalLines && !(totalLines === 0 && startLine === 1)) {
    throw new Error('Offset ' + startLine + ' is beyond end of file (' + totalLines + ' lines total)')
  }
  const endLine = selected.length > 0 ? startLine + selected.length - 1 : 0
  process.stdout.write(JSON.stringify({ content: selected.join('\\n'), startLine, endLine, totalLines, ...(truncatedLineCount > 0 ? { truncatedLineCount } : {}) }))
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
`
}
