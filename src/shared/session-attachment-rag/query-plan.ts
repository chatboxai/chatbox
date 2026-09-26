import type { SessionAttachmentQueryPlan, SessionAttachmentStoryFilter } from '../types'

export const QUERY_RECALL_TOP_K = 20
export const QUERY_RETURN_TOP_K = 8
export const QUERY_RETURN_TOP_K_MAX = 12

export interface NormalizedQueryPlan {
  recallTopK: number
  finalTopK: number
  rerank:
    | {
        enabled: true
        model?: string
      }
    | {
        enabled: false
      }
  storyFilter?: SessionAttachmentStoryFilter
}

export function dedupeByParent<T extends { parentId: number }>(results: T[]): T[] {
  const deduped = new Map<number, T>()
  for (const result of results) {
    if (!deduped.has(result.parentId)) {
      deduped.set(result.parentId, result)
    }
  }
  return [...deduped.values()]
}

/**
 * Format a user query for logs without leaking the full text.
 */
export function summarizeQuery(query: string): string {
  const trimmed = query.trim()
  const length = trimmed.length
  const previewLength = 16
  const preview = trimmed.slice(0, previewLength).replace(/\s+/g, ' ')
  const ellipsis = length > previewLength ? '...' : ''
  return `len=${length}, prefix="${preview}${ellipsis}"`
}

export function normalizeQueryPlan(plan?: Partial<SessionAttachmentQueryPlan>): NormalizedQueryPlan {
  const recallTopK = Math.max(1, Math.min(plan?.recallTopK ?? QUERY_RECALL_TOP_K, QUERY_RECALL_TOP_K))
  const finalTopK = Math.max(1, Math.min(plan?.finalTopK ?? QUERY_RETURN_TOP_K, QUERY_RETURN_TOP_K_MAX))
  const rerankPlan = plan?.rerank?.enabled ? { enabled: true as const, model: plan.rerank.model } : { enabled: false as const }
  return { recallTopK, finalTopK, rerank: rerankPlan, storyFilter: plan?.storyFilter }
}
