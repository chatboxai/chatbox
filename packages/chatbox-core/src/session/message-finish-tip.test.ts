import { describe, expect, it } from 'vitest'
import { getMessageFinishTip } from './message-finish-tip'

const t = (key: string) => key
const message = { role: 'assistant' as const }

describe('getMessageFinishTip', () => {
  it.each(['content-filter', 'length', 'error'])('explains %s even for an empty response', (finishReason) => {
    expect(getMessageFinishTip({ ...message, finishReason }, t)).toBeTruthy()
  })
  it('suggests asking the model to continue when the length limit is reached', () => {
    const tip = getMessageFinishTip({ ...message, finishReason: 'length' }, t)
    expect(tip).toContain('content may be incomplete')
    expect(tip).toContain('Send “Continue”')
  })
  it.each(['stop', 'tool-calls', 'canceled', 'tool-call-paused', 'steered', 'unknown', undefined])(
    'does not show an interruption tip for %s',
    (finishReason) => {
      expect(getMessageFinishTip({ ...message, finishReason }, t)).toBeUndefined()
    }
  )
  it('hides a stale reason while generation resumes', () => {
    expect(getMessageFinishTip({ ...message, finishReason: 'length', generating: true }, t)).toBeUndefined()
  })
  it('does not show tips on user messages', () => {
    expect(getMessageFinishTip({ role: 'user', finishReason: 'length' }, t)).toBeUndefined()
  })
  it.each([{ error: 'Network error' }, { errorCode: 500 }])('avoids duplicating an existing error card', (error) => {
    expect(getMessageFinishTip({ ...message, finishReason: 'error', ...error }, t)).toBeUndefined()
  })
})
