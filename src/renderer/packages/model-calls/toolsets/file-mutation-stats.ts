/** Approval-time change counts for file mutations. */

import type { FileMutationApprovalStats } from '@shared/types'
import { structuredPatch } from 'diff'

export type EditStatsInput = { old_text: string; new_text: string }
export type FileMutationDisplayStats = FileMutationApprovalStats & { approximate?: boolean }

type FileMutationPauseSummary = {
  title: string
  preview: string
  stats?: FileMutationApprovalStats
}

const LEGACY_TRUNCATION_MARKER = '... [truncated]'
const LEGACY_EDIT_PATTERN =
  /(?:^|\n\n)# Edit \d+\n--- old\n([\s\S]*?)\n\+\+\+ new\n([\s\S]*?)(?=\n\n# Edit \d+\n--- old\n|$)/g

function countLines(text: string): number {
  if (!text) return 0
  let lines = 1
  for (let i = 0; i + 1 < text.length; i++) if (text.charCodeAt(i) === 10) lines++
  return lines
}

/** Changed-line totals for the supplied edits; approximation is explicit when the budget is exhausted. */
export function buildEditStats(edits: EditStatsInput[]): FileMutationApprovalStats {
  let addedLines = 0
  let removedLines = 0
  let approximate = false
  let remainingCharacters = 100_000
  const deadline = Date.now() + 50
  for (const edit of edits) {
    if (edit.old_text === edit.new_text) continue
    const oldLines = countLines(edit.old_text)
    const newLines = countLines(edit.new_text)
    remainingCharacters -= edit.old_text.length + edit.new_text.length
    const remainingTime = deadline - Date.now()
    const patch =
      remainingCharacters >= 0 && remainingTime > 0 && oldLines + newLines <= 10_000
        ? structuredPatch('', '', edit.old_text, edit.new_text, undefined, undefined, {
            timeout: remainingTime,
            maxEditLength: 4000,
          })
        : undefined
    if (!patch) {
      approximate = true
      addedLines += newLines
      removedLines += oldLines
      continue
    }
    for (const hunk of patch.hunks)
      for (const line of hunk.lines) {
        if (line.startsWith('+')) addedLines++
        else if (line.startsWith('-')) removedLines++
      }
  }
  return { mode: 'edit', edits: edits.length, addedLines, removedLines, ...(approximate ? { approximate: true } : {}) }
}

/** Whole-file writes have no before-image, so every output line is new. */
export function buildWriteStats(content: string): FileMutationApprovalStats {
  return {
    mode: 'write',
    addedLines: content.length === 0 ? 0 : content.split('\n').length,
    removedLines: 0,
  }
}

function stripLegacyTruncation(text: string): { text: string; truncated: boolean } {
  if (text === LEGACY_TRUNCATION_MARKER) return { text: '', truncated: true }
  const suffix = `\n${LEGACY_TRUNCATION_MARKER}`
  return text.endsWith(suffix) ? { text: text.slice(0, -suffix.length), truncated: true } : { text, truncated: false }
}

/**
 * Older persisted pauses only have a bounded preview. Recover magnitude from
 * that data without ever rendering its contents; a truncated preview yields an
 * explicitly approximate count.
 */
export function getFileMutationDisplayStats(pause: FileMutationPauseSummary): FileMutationDisplayStats | undefined {
  if (pause.stats) return pause.stats
  if (!pause.preview) return undefined

  if (pause.title.startsWith('Write file:')) {
    const legacy = stripLegacyTruncation(pause.preview)
    return { ...buildWriteStats(legacy.text), approximate: legacy.truncated || undefined }
  }

  const edits: EditStatsInput[] = []
  let approximate = false
  for (const match of pause.preview.matchAll(LEGACY_EDIT_PATTERN)) {
    const oldText = stripLegacyTruncation(match[1])
    const newText = stripLegacyTruncation(match[2])
    approximate ||= oldText.truncated || newText.truncated
    edits.push({ old_text: oldText.text, new_text: newText.text })
  }
  if (edits.length === 0) return undefined
  return { ...buildEditStats(edits), approximate: approximate || undefined }
}
