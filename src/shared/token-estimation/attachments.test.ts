import { describe, expect, it } from 'vitest'
import { injectAttachments } from '../context'
import type { Message } from '../types'
import { getMessageText } from '../utils/message'
import { analyzeAttachmentTokens, IMAGE_TOKEN_ESTIMATE } from './attachments'
import { estimateTokensForTokenizerType } from './tokenizer'

const file = {
  id: 'file',
  name: 'book.pdf',
  fileType: 'application/pdf',
  storageKey: 'book',
  lineCount: 10000,
  byteLength: 500000,
  tokenCountMap: { default: 100000 },
}
describe('shared attachment costs', () => {
  it.each(['ready', 'failed'] as const)('counts the actual retrieval envelope for %s indexes', async (status) => {
    const message: Message = {
      id: 'm',
      role: 'user',
      contentParts: [],
      files: [{ ...file, ragMode: 'session-retrieval', sessionAttachmentIndexStatus: status }],
    }
    const result = analyzeAttachmentTokens(message, 'default')
    const payload = await injectAttachments(
      [message],
      {
        read: async () => {
          throw Error('RAG must not read the full text')
        },
      },
      false,
      false
    )
    expect(result.tokens).toBe(estimateTokensForTokenizerType(getMessageText(payload[0]), 'default'))
    expect(result.tokens).toBeLessThan(1000)
    expect(result.missing).toEqual([])
  })
  it('counts sandbox metadata from the request envelope, including retrieval guidance', async () => {
    const message: Message = {
      id: 'm',
      role: 'user',
      contentParts: [],
      files: [{ ...file, ragMode: 'session-retrieval' }],
    }
    const payload = await injectAttachments([message], { read: async () => null }, true, true)
    expect(analyzeAttachmentTokens(message, 'default', { sandboxMode: true }).tokens).toBe(
      estimateTokensForTokenizerType(getMessageText(payload[0]), 'default')
    )
  })
  it('counts image input separately and marks it approximate', () => {
    const message: Message = { id: 'image', role: 'user', contentParts: [{ type: 'image', storageKey: 'image:1' }] }
    expect(analyzeAttachmentTokens(message, 'default')).toEqual({
      tokens: IMAGE_TOKEN_ESTIMATE,
      missing: [],
      approximate: true,
    })
  })
})
