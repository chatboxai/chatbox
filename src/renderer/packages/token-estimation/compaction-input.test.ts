import type { Message, Session } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { estimateCompactionInputTokens } from './compaction-input'
import { estimateDraftTokensImmediately } from './draft-tokenization'

vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { get: async () => 'file body' } }))
const session: Session = {
  id: 's',
  name: 'test',
  messages: [
    {
      id: 'history',
      role: 'user',
      contentParts: [{ type: 'text', text: 'History' }],
      tokenCountMap: { default: 99999, deepseek: 1 },
    },
  ],
}
it('includes a long pending message and resolves the selected tokenizer independently of cached values', async () => {
  const pending: Message = {
    id: 'pending',
    role: 'user',
    contentParts: [{ type: 'text', text: '长文本'.repeat(2000) }],
  }
  const result = await estimateCompactionInputTokens(
    session,
    pending,
    { provider: 'deepseek', modelId: 'deepseek-chat' },
    undefined,
    {}
  )
  expect(result).toBe(1 + estimateDraftTokensImmediately('长文本'.repeat(2000), 'deepseek'))
})
it('respects the upcoming send window at a zero history limit', async () => {
  const pending: Message = { id: 'pending', role: 'user', contentParts: [{ type: 'text', text: 'new' }] }
  expect(await estimateCompactionInputTokens(session, pending, undefined, 0, {})).toBe(
    estimateDraftTokensImmediately('new', 'default')
  )
})
