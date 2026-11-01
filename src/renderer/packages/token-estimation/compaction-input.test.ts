import { estimateTokensForTokenizerType } from '@shared/token-estimation/tokenizer'
import { TokenEstimationService } from '@chatbox/core/application/token-estimation'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { Message } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { estimateDraftTokensImmediately } from './draft-tokenization'

async function fixture() {
  const repository = new InMemorySessionRepository()
  await repository.createSessionRows({ id: 's', name: 'test' }, [
    {
      id: 'history',
      role: 'user',
      contentParts: [{ type: 'text', text: 'History' }],
      tokenCountMap: { default: 99999, deepseek: 1 },
    },
  ])
  const transcript = vi.spyOn(repository, 'readSessionTranscriptWindow')
  const service = new TokenEstimationService({ get: async () => 'file body' }, repository)
  return { service, transcript }
}

it('estimates pending input and independent row history using the selected tokenizer', async () => {
  const { service, transcript } = await fixture()
  const pending: Message = {
    id: 'pending',
    role: 'user',
    contentParts: [{ type: 'text', text: '长文本'.repeat(2000) }],
  }
  const result = await service.estimate({
    sessionId: 's',
    constructedMessage: pending,
    model: { provider: 'deepseek', modelId: 'deepseek-chat' },
  })
  expect(result.totalTokens).toBe(
    estimateTokensForTokenizerType('History', 'deepseek') +
      estimateDraftTokensImmediately('长文本'.repeat(2000), 'deepseek')
  )
  expect(transcript).not.toHaveBeenCalled()
})

it('respects a zero history limit while including the pending input', async () => {
  const { service } = await fixture()
  const pending: Message = { id: 'pending', role: 'user', contentParts: [{ type: 'text', text: 'new' }] }
  const result = await service.estimate({ sessionId: 's', constructedMessage: pending, maxContextMessageCount: 0 })
  expect(result.contextTokens).toBe(0)
  expect(result.totalTokens).toBe(estimateDraftTokensImmediately('new', 'default'))
})

it('counts empty draft and instructions as zero for DeepSeek', async () => {
  const { service } = await fixture()
  const result = await service.estimate({
    additionalInstructions: '',
    model: { provider: 'deepseek', modelId: 'deepseek-chat' },
  })
  expect(result.currentInputTokens).toBe(0)
  expect(result.contextTokens).toBe(0)
  expect(result.totalTokens).toBe(0)
})
