import { describe, expect, it } from 'vitest'
import { resolveWebBrowsing } from './web-browsing'

describe('resolveWebBrowsing', () => {
  it.each([
    { explicit: undefined, expected: true, provider: 'chatbox-ai' },
    { explicit: undefined, expected: false, provider: 'openai' },
    { explicit: undefined, expected: false, provider: undefined },
    { explicit: true, expected: true, provider: 'openai' },
    { explicit: false, expected: false, provider: 'chatbox-ai' },
  ] as const)('resolves provider=$provider explicit=$explicit to $expected', ({ explicit, expected, provider }) => {
    expect(resolveWebBrowsing(explicit, provider)).toBe(expected)
  })
})
