import { structuredPatch } from 'diff'
import { type FileEditSummary, MAX_EDIT_PREVIEW_CHARACTERS } from './file-edits'

const MAX_INPUT_CHARACTERS = 1_000_000
const MAX_INPUT_LINES = 20_000

function exceedsLineBudget(text: string): boolean {
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > MAX_INPUT_LINES) return true
  }
  return false
}

/** Keep model output and persisted approval previews bounded. */
export function summarizeFileEdit(before: string, after: string, edits: number): FileEditSummary {
  const summary: FileEditSummary = { success: true, changed: before !== after, edits }
  if (!summary.changed) return { ...summary, addedLines: 0, removedLines: 0, diff: '' }
  // Tokenization happens before jsdiff's search timeout. Bound that allocation too.
  if (before.length + after.length > MAX_INPUT_CHARACTERS || exceedsLineBudget(before) || exceedsLineBudget(after))
    return { ...summary, diffTruncated: true }
  const patch = structuredPatch('file', 'file', before, after, undefined, undefined, {
    context: 3,
    timeout: 100,
    maxEditLength: 4000,
  })
  if (!patch) return { ...summary, diffTruncated: true }
  let addedLines = 0
  let removedLines = 0
  let preview = ''
  let truncated = false
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) addedLines++
      if (line.startsWith('-')) removedLines++
    }
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    for (const line of [header, ...hunk.lines]) {
      if (truncated) break
      // Keep complete lines and avoid constructing an unbounded joined hunk.
      if (preview.length + line.length + 1 > MAX_EDIT_PREVIEW_CHARACTERS) {
        truncated = true
        break
      }
      preview += `${line}\n`
    }
  }
  return { ...summary, addedLines, removedLines, diff: preview, diffTruncated: truncated }
}

/** Model/session results retain a shorter excerpt than the human approval preview. */
export function compactFileEditSummary(summary: FileEditSummary): FileEditSummary {
  if (!summary.diff || summary.diff.length <= 1200) return summary
  const end = summary.diff.lastIndexOf('\n', 1199)
  return { ...summary, diff: end < 0 ? '' : summary.diff.slice(0, end + 1), diffTruncated: true }
}
