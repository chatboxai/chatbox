import { describe, expect, it } from 'vitest'
import {
  buildAttachmentChunks,
  buildEmbeddedText,
  chunkPlainDocument,
  chunkStructuredDocument,
  selectAttachmentChunkingPipeline,
} from './chunking'

describe('chunking', () => {
  it('selects structured chunking pipeline for markdown and code files', () => {
    expect(selectAttachmentChunkingPipeline('document.md')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('notes.mdx')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('data.json')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('main.ts')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('script.py')).toBe('structured')
  })

  it('selects plain chunking pipeline for txt and other formats', () => {
    expect(selectAttachmentChunkingPipeline('novel.txt')).toBe('plain')
    expect(selectAttachmentChunkingPipeline('data.csv')).toBe('plain')
    expect(selectAttachmentChunkingPipeline(undefined)).toBe('plain')
  })

  it('formats embedded text with filename, section path, and text', () => {
    const embedded = buildEmbeddedText({
      filename: 'gu_zhen_ren.md',
      sectionPath: 'Chapter 1: The Beginning',
      text: 'Fang Yuan opened his eyes in Qing Mao Mountain.',
    })
    expect(embedded).toBe(
      '[gu_zhen_ren.md > Chapter 1: The Beginning]\nFang Yuan opened his eyes in Qing Mao Mountain.'
    )
  })

  it('chunks structured markdown document into parents and children', async () => {
    const mdContent = `
# Character Profile
Fang Yuan is the protagonist of Revered Insanity (Gu Zhen Ren).

## Cultivation
He cultivates Time path and Blood path in his past life, and later the Great Strength True Martial physique.

## Key Relics
Spring Autumn Cicada is his vital Gu worm, allowing him to reverse time and be reborn 500 years into the past.
`
    const result = await chunkStructuredDocument(mdContent)
    expect(result.parents.length).toBeGreaterThan(0)
    expect(result.children.length).toBeGreaterThan(0)

    for (const parent of result.parents) {
      expect(parent.text).toBeTruthy()
      expect(parent.tokenEstimate).toBeGreaterThan(0)
      expect(parent.charCount).toBe(parent.text.length)
    }

    for (const child of result.children) {
      expect(child.rawText).toBeTruthy()
      expect(child.parentOrder).toBeDefined()
      expect(child.chunkOrder).toBeDefined()
    }
  })

  it('chunks plain text document into parents and children', async () => {
    const plainContent = 'Line 1\nLine 2\nLine 3\n' + 'Word '.repeat(500)
    const result = await chunkPlainDocument(plainContent)
    expect(result.parents.length).toBeGreaterThan(0)
    expect(result.children.length).toBeGreaterThan(0)
    expect(result.children[0].rawText.length).toBeGreaterThan(0)
  })

  it('dispatches buildAttachmentChunks based on file extension', async () => {
    const content = '# Heading\nSome content for testing dispatch.'
    const structuredResult = await buildAttachmentChunks(content, 'test.md')
    expect(structuredResult.parents.length).toBeGreaterThan(0)

    const plainResult = await buildAttachmentChunks(content, 'test.txt')
    expect(plainResult.parents.length).toBeGreaterThan(0)
  })
})
