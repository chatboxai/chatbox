import { selectContextMessages } from '@shared/context'
import type { Message } from '@shared/types'
import { expect, it } from 'vitest'
import { selectMessagesForSendContext } from './attachment-payload'

it('uses the actual send window when the input is already included', () => {
  const messages: Message[] = [
    { id: 'system', role: 'system', contentParts: [] },
    ...Array.from({ length: 10 }, (_, index) => ({ id: String(index), role: 'user' as const, contentParts: [] })),
  ]
  for (const maxContextMessageCount of [0, 1, 4, 100])
    expect(selectMessagesForSendContext({ msgs: messages, settings: { maxContextMessageCount } })).toEqual(
      selectContextMessages(messages, { maxContextMessageCount })
    )
})
