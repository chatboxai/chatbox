import { describe, expect, it } from 'vitest'
import { SESSION_TEXT_TOKEN_VERSION, type SessionTextTokenResult } from '../../ports/session-text-tokens'
import { mergeSessionTextTokenResults } from './session-text-tokens'

function result(
  messageId: string,
  payloadId: string,
  tokens: number,
  calculatedAt: number,
  tokenizerType: SessionTextTokenResult['value']['tokenizerType'] = 'default'
): SessionTextTokenResult {
  return {
    source: {
      sessionId: 's',
      messageId,
      payloadId,
      calculationVersion: SESSION_TEXT_TOKEN_VERSION,
      textDigest: 'digest',
      text: 'text',
    },
    value: { tokenizerType, tokens, calculatedAt, sourceDigest: 'digest' },
  }
}

describe('mergeSessionTextTokenResults', () => {
  it('retains separate batches and tokenizer values while rejecting an older calculation', () => {
    const first = result('a', 'payload-a', 7, 2)
    const second = result('b', 'payload-b', 8, 2)
    const alternate = result('a', 'payload-a', 9, 2, 'deepseek')
    const initial = { sources: { a: first.source, b: second.source }, results: [first] }
    const next = mergeSessionTextTokenResults(initial, [second, alternate, result('a', 'payload-a', 3, 1)])
    expect(next.results).toEqual([first, second, alternate])
    expect(next.sources).toBe(initial.sources)
    expect(initial.results).toEqual([first])
  })

  it('drops results for replaced or foreign payload identities', () => {
    const stale = result('a', 'old', 7, 1)
    const current = result('a', 'new', 8, 2)
    const foreign = { ...current, source: { ...current.source, sessionId: 'other' } }
    const wrongDigest = { ...current, source: { ...current.source, textDigest: 'different' } }
    expect(
      mergeSessionTextTokenResults({ sources: { a: current.source }, results: [stale] }, [foreign, wrongDigest]).results
    ).toEqual([])
    expect(
      mergeSessionTextTokenResults({ sources: { a: current.source }, results: [stale] }, [current]).results
    ).toEqual([current])
  })
})
