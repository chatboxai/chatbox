import assert from 'node:assert/strict'
import { buildViewImageToolResultContent, buildViewImageUserMessage } from '@shared/tools/view-image'
import type { ModelMessage } from 'ai'
import { describe, it } from 'vitest'
import { estimateModelMessageTokens, findKeptContentPartStartIndex } from './mid-run-compaction'

function toolImage(size: number): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'image-1',
        toolName: 'view_image',
        output: buildViewImageToolResultContent({
          filePath: 'a.png',
          base64Data: 'a'.repeat(size),
          mediaType: 'image/png',
        }),
      },
    ],
  }
}

describe('mid-run protocol media estimates', () => {
  it('retains the text and reasoning that precede the kept tool call', () => {
    assert.equal(
      findKeptContentPartStartIndex(
        [
          { type: 'tool-call', state: 'result', toolCallId: 'old', toolName: 'search', args: {}, result: 'old' },
          { type: 'text', text: 'next step' },
          { type: 'reasoning', text: 'signed reasoning' },
          { type: 'tool-call', state: 'result', toolCallId: 'keep', toolName: 'search', args: {}, result: 'new' },
        ],
        new Set(['keep'])
      ),
      1
    )
  })

  it('does not count base64 bytes inside a native tool result', () => {
    assert.equal(estimateModelMessageTokens(toolImage(100)), estimateModelMessageTokens(toolImage(1_000_000)))
    assert.ok(estimateModelMessageTokens(toolImage(1_000_000)) < 200)
  })

  it('treats native tool media and synthetic user media consistently', () => {
    const user = buildViewImageUserMessage([
      { filePath: 'a.png', base64Data: 'a'.repeat(1_000_000), mediaType: 'image/png' },
    ])
    assert.ok(Math.abs(estimateModelMessageTokens(toolImage(1_000_000)) - estimateModelMessageTokens(user)) < 100)
  })

  it('still counts text alongside media', () => {
    const withText = toolImage(1_000_000)
    const content = withText.content as Array<{ output: { value: unknown[] } }>
    content[0].output.value.push({ type: 'text', text: 'important result '.repeat(1000) })
    assert.ok(estimateModelMessageTokens(withText) - estimateModelMessageTokens(toolImage(1_000_000)) > 3000)
  })

  it('does not exempt image-shaped values inside JSON tool results', () => {
    const json: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'json',
          toolName: 'query',
          output: { type: 'json', value: { type: 'image-data', data: 'x'.repeat(100_000) } },
        },
      ],
    }
    assert.ok(estimateModelMessageTokens(json) > 25_000)
  })
})
