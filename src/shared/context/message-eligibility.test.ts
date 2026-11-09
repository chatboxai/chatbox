import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { selectMessagesBeforeTarget } from './message-eligibility'

const user: Message = { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Run it' }] }
const resumed: Message = {
  id: 'assistant',
  role: 'assistant',
  generating: true,
  contentParts: [
    { type: 'tool-call', state: 'result', toolCallId: 'call-1', toolName: 'exec', args: {}, result: 'ok' },
  ],
}

describe('selectMessagesBeforeTarget', () => {
  it('passes a resumed target on as a complete message', () => {
    const selected = selectMessagesBeforeTarget([user, resumed], 2, true)

    expect(selected).toEqual([user, { ...resumed, generating: false }])
    expect(resumed.generating).toBe(true)
  })

  it('leaves the messages before a new target unchanged', () => {
    const earlier: Message = { ...resumed, id: 'earlier' }

    expect(selectMessagesBeforeTarget([user, earlier, resumed], 2, false)).toEqual([user, earlier])
  })

  it('only clears the flag of the message the continuation resumes', () => {
    const generatingSibling: Message = { ...resumed, id: 'sibling' }
    const selected = selectMessagesBeforeTarget([generatingSibling, user, resumed], 3, true)

    expect(selected.map((message) => message.generating)).toEqual([true, undefined, false])
  })
})
