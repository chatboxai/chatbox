import { describe, expect, it } from 'vitest'
import {
  buildMobileChildChunks,
  buildMobileParentBlocks,
  chunkMobileDocument,
  estimateTokenCount,
} from '../chunking'

describe('mobile chunking', () => {
  it('estimates token count as roughly length / 4', () => {
    expect(estimateTokenCount('hello world')).toBe(3)
    expect(estimateTokenCount('a'.repeat(400))).toBe(100)
  })

  it('splits short text into a single parent block and child chunk', () => {
    const text = 'This is a short document for testing mobile chunking.'
    const result = chunkMobileDocument(text)

    expect(result.parents).toHaveLength(1)
    expect(result.parents[0].text).toBe(text)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].rawText).toBe(text)
  })

  it('splits long content into multiple parent blocks', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: ${'sample text '.repeat(30)}`)
    const text = paragraphs.join('\n\n')

    const parents = buildMobileParentBlocks(text)
    expect(parents.length).toBeGreaterThan(1)

    for (const parent of parents) {
      expect(parent.text.length).toBeLessThanOrEqual(2400)
    }
  })

  it('creates child chunks with overlap from parent blocks', () => {
    const parentText = 'Sentence one. '.repeat(50)
    const parents = [{
      parentOrder: 0,
      text: parentText,
      tokenEstimate: estimateTokenCount(parentText),
      charCount: parentText.length,
    }]

    const children = buildMobileChildChunks(parents)
    expect(children.length).toBeGreaterThan(1)

    for (const child of children) {
      expect(child.rawText.length).toBeLessThanOrEqual(448)
      expect(child.parentOrder).toBe(0)
    }
  })
})
