import type { Message } from '@shared/types'
import { MessageSchema } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { convertToModelMessages } from './model-message-converter'

const noImage = async () => null

describe('reasoning replay protocol boundaries', () => {
  it('keeps persisted Gemini text signatures out of auxiliary requests by default', async () => {
    const message = MessageSchema.parse(
      JSON.parse(
        JSON.stringify({
          id: 'answer',
          role: 'assistant',
          contentParts: [
            {
              type: 'text',
              text: 'Answer',
              stepIndex: 2,
              providerMetadata: { google: { thoughtSignature: 'signed-text' } },
            },
          ],
        })
      )
    )
    expect(message.contentParts[0]).toMatchObject({
      providerMetadata: { google: { thoughtSignature: 'signed-text' } },
      stepIndex: 2,
    })
    const plain = await convertToModelMessages([message], noImage)
    expect(plain[0].content).toEqual([{ type: 'text', text: 'Answer' }])
    const signed = await convertToModelMessages([message], noImage, {
      modelSupportVision: false,
      replayNamespaces: ['google'],
    })
    expect(signed[0].content).toEqual([
      { type: 'text', text: 'Answer', providerOptions: { google: { thoughtSignature: 'signed-text' } } },
    ])
  })

  it('omits id-only reasoning on stateless Responses while preserving encrypted-only blocks', async () => {
    const message: Message = {
      id: 'answer',
      role: 'assistant',
      contentParts: [
        { type: 'reasoning', text: 'summary', providerMetadata: { openai: { itemId: 'rs_unstored' } } },
        {
          type: 'reasoning',
          text: '',
          protocolOnly: true,
          providerMetadata: { openai: { reasoningEncryptedContent: 'encrypted', chatboxReplaySource: 'source-a' } },
        },
        { type: 'text', text: 'Answer', providerMetadata: { openai: { itemId: 'msg_unstored' } } },
      ],
    }
    const output = await convertToModelMessages([message], noImage, {
      modelSupportVision: false,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
      replayNamespaces: ['openai'],
      reasoningReplaySource: 'source-a',
    })
    expect(output[0].content).toEqual([
      { type: 'reasoning', text: '', providerOptions: { openai: { reasoningEncryptedContent: 'encrypted' } } },
      { type: 'text', text: 'Answer' },
    ])
    expect(message.contentParts[0]).toMatchObject({ providerMetadata: { openai: { itemId: 'rs_unstored' } } })
  })
  it('replays earlier summaries of a Responses item with its encrypted content', async () => {
    const source = 'source-a'
    const message: Message = {
      id: 'answer',
      role: 'assistant',
      contentParts: [
        {
          type: 'reasoning',
          text: 'First',
          providerMetadata: { openai: { itemId: 'rs_0', chatboxReplaySource: source } },
        },
        {
          type: 'reasoning',
          text: 'Second',
          providerMetadata: {
            openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted', chatboxReplaySource: source },
          },
        },
        {
          type: 'reasoning',
          text: 'Orphan',
          providerMetadata: { openai: { itemId: 'rs_1', chatboxReplaySource: source } },
        },
        { type: 'text', text: 'Answer' },
      ],
    }
    const options = {
      modelSupportVision: false,
      preserveReasoning: 'all-turns' as const,
      signedReasoningOnly: true,
      replayNamespaces: ['openai'],
    }
    expect(
      (await convertToModelMessages([message], noImage, { ...options, reasoningReplaySource: source }))[0].content
    ).toEqual([
      { type: 'reasoning', text: 'First', providerOptions: { openai: { itemId: 'rs_0' } } },
      {
        type: 'reasoning',
        text: 'Second',
        providerOptions: { openai: { itemId: 'rs_0', reasoningEncryptedContent: 'encrypted' } },
      },
      { type: 'text', text: 'Answer' },
    ])
    expect(
      (await convertToModelMessages([message], noImage, { ...options, reasoningReplaySource: 'source-b' }))[0].content
    ).toEqual([{ type: 'text', text: 'Answer' }])
  })
})
