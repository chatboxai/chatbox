import { describe, expect, it } from 'vitest'
import {
  dedupeByParent,
  normalizeQueryPlan,
  QUERY_RECALL_TOP_K,
  QUERY_RETURN_TOP_K,
  QUERY_RETURN_TOP_K_MAX,
  summarizeQuery,
} from './query-plan'

describe('query-plan', () => {
  describe('normalizeQueryPlan', () => {
    it('uses defaults when no plan provided', () => {
      const plan = normalizeQueryPlan()
      expect(plan.recallTopK).toBe(QUERY_RECALL_TOP_K)
      expect(plan.finalTopK).toBe(QUERY_RETURN_TOP_K)
      expect(plan.rerank.enabled).toBe(false)
    })

    it('clamps recallTopK and finalTopK within bounds', () => {
      const plan = normalizeQueryPlan({
        recallTopK: 100,
        finalTopK: 50,
      })
      expect(plan.recallTopK).toBe(QUERY_RECALL_TOP_K)
      expect(plan.finalTopK).toBe(QUERY_RETURN_TOP_K_MAX)

      const minPlan = normalizeQueryPlan({
        recallTopK: -5,
        finalTopK: 0,
      })
      expect(minPlan.recallTopK).toBe(1)
      expect(minPlan.finalTopK).toBe(1)
    })

    it('normalizes rerank config', () => {
      const planWithRerank = normalizeQueryPlan({
        rerank: {
          enabled: true,
          model: 'cohere:rerank-v3.5',
        },
      })
      expect(planWithRerank.rerank).toEqual({
        enabled: true,
        model: 'cohere:rerank-v3.5',
      })
    })
  })

  describe('dedupeByParent', () => {
    it('keeps first result for duplicate parent IDs while preserving order', () => {
      const results = [
        { parentId: 1, score: 0.9, text: 'a' },
        { parentId: 2, score: 0.85, text: 'b' },
        { parentId: 1, score: 0.8, text: 'c' },
        { parentId: 3, score: 0.7, text: 'd' },
      ]
      const deduped = dedupeByParent(results)
      expect(deduped).toHaveLength(3)
      expect(deduped.map((r) => r.parentId)).toEqual([1, 2, 3])
      expect(deduped[0].text).toBe('a')
    })
  })

  describe('summarizeQuery', () => {
    it('truncates and formats query preview safely', () => {
      const summary = summarizeQuery('What is the strength of Fang Yuan in Gu Zhen Ren?')
      expect(summary).toContain('len=')
      expect(summary).toContain('prefix="')
    })
  })
})
