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

function countEditLines(oldText: string, newText: string): { addedLines: number; removedLines: number } {
  const patch = structuredPatch('', '', oldText, newText)
  let addedLines = 0
  let removedLines = 0

  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) addedLines++
      else if (line.startsWith('-')) removedLines++
    }
  }

  return { addedLines, removedLines }
}

/** Exact changed-line totals across all search-and-replace edits. */
export function buildEditStats(edits: EditStatsInput[]): FileMutationApprovalStats {
  let addedLines = 0
  let removedLines = 0
  for (const edit of edits) {
    const counts = countEditLines(edit.old_text, edit.new_text)
    addedLines += counts.addedLines
    removedLines += counts.removedLines
  }
  return { mode: 'edit', edits: edits.length, addedLines, removedLines }
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
