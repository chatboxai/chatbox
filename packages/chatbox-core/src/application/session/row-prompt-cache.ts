import { selectContextEntries } from '@shared/context/builder'
import type { SessionPromptCacheRequest } from '../../ports/session-prompt-cache-source'
import type { SessionRowStorePort } from '../../ports/session-row-store'
import { PROMPT_CACHE_CONFIRM_MIN_CHARS } from '../../session/prompt-cache-policy'
import { readRowContextPlan, type RowContextEntry } from './row-context'

/** The same provider-context selection, evaluated from stored facts without body reads. */
export async function readRowPromptCacheDecision(
  rows: SessionRowStorePort,
  request: SessionPromptCacheRequest
): Promise<boolean> {
  if (request.mode !== 'work') return false
  const plan = await readRowContextPlan(rows, { sessionId: request.sessionId })
  if (!plan) return false
  const select = (entries: RowContextEntry[]) => {
    let end = entries.length
    let started = false
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      if (entry.role === 'assistant' && entry.row.status === 'generating' && !entry.row.facts.isForkMarker) {
        end = index
        started = true
        break
      }
    }
    const selected = selectContextEntries(entries.slice(0, end), {
      compactionPoints: plan.thread.compactionPoints,
      maxContextMessageCount: request.maxContextMessageCount,
    })
    return { entries: selected, started: started || selected.some((entry) => entry.role === 'assistant') }
  }
  const current = select(plan.entries)
  if (request.deletion) {
    const { messageId, target } = request.deletion
    const deleted = plan.entries.find((entry) => entry.id === messageId)
    if (!deleted || deleted.row.facts.isForkMarker) return false
    if (target === 'message') {
      const last = plan.entries.findLast((entry) => !entry.row.facts.isForkMarker && !entry.isSummary)
      if (last?.id === messageId) return false
    }
    const next = select(plan.entries.filter((entry) => entry.id !== messageId))
    if (
      current.entries.length === next.entries.length &&
      current.entries.every((entry, index) => entry.id === next.entries[index].id)
    )
      return false
  }
  let chars = 0
  let hasTools = false
  let started = current.started
  for (const entry of current.entries) {
    const { facts } = entry.row
    if (facts.isForkMarker) continue
    if (entry.isSummary) return true
    started ||= entry.role === 'assistant'
    hasTools ||= facts.hasToolCall
    if (entry.role !== 'system' && !(entry.role === 'assistant' && entry.row.status === 'generating'))
      chars += facts.promptCacheChars
    if (started && (hasTools || chars >= PROMPT_CACHE_CONFIRM_MIN_CHARS)) return true
  }
  return false
}
