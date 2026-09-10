import { describe, expect, it } from 'vitest'
import { getDefaultCompactionPrompt, summarizeConversation } from './prompts'
import type { Message } from './types'

const messages: Message[] = [
  { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Original conversation' }] },
]

describe('summarizeConversation', () => {
  it.each([undefined, '', '   \n'])('uses the built-in language-aware prompt for %j', (prompt) => {
    const result = summarizeConversation(messages, '简体中文', prompt)
    expect(result.at(-1)?.contentParts).toEqual([{ type: 'text', text: getDefaultCompactionPrompt('简体中文') }])
    expect(getDefaultCompactionPrompt('简体中文')).toContain('Write in 简体中文')
  })

  it('replaces the instruction while preserving conversation messages', () => {
    const result = summarizeConversation(messages, 'English', ' Keep exact paths.\n\nPreserve unfinished tasks. ')
    expect(result.slice(0, -1)).toEqual(messages)
    expect(messages).toHaveLength(1)
    expect(result.at(-1)).toMatchObject({
      role: 'user',
      contentParts: [{ type: 'text', text: 'Keep exact paths.\n\nPreserve unfinished tasks.' }],
    })
  })
})
