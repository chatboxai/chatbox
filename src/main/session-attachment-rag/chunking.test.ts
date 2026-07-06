import { describe, expect, it } from 'vitest'
import {
  type AttachmentChunkingResult,
  buildAttachmentChunks,
  buildEmbeddedText,
  chunkPlainDocument,
  chunkStructuredDocument,
  selectAttachmentChunkingPipeline,
} from './chunking'

// Character-count constants mirrored from chunking.ts (kept in sync by intent,
// not import, since they are module-private).
const PARENT_HARD_CAP_CHARS = 2400

function estimate(text: string): number {
  return Math.ceil(text.length / 4)
}

// Structural invariants that must hold for any chunking result, independent of
// how the underlying MDocument recursive splitter divides text.
function assertResultInvariants(result: AttachmentChunkingResult) {
  const parentOrders = new Set(result.parents.map((p) => p.parentOrder))
  result.parents.forEach((parent, index) => {
    expect(parent.parentOrder).toBe(index) // sequential from 0
    expect(parent.text).toBe(parent.text.trim()) // trimmed
    expect(parent.text.length).toBeGreaterThan(0)
    expect(parent.charCount).toBe(parent.text.length)
    expect(parent.tokenEstimate).toBe(estimate(parent.text))
  })
  result.children.forEach((child, index) => {
    expect(child.chunkOrder).toBe(index) // sequential from 0 across all parents
    expect(child.rawText).toBe(child.rawText.trim())
    expect(child.rawText.length).toBeGreaterThan(0)
    expect(child.tokenEstimate).toBe(estimate(child.rawText))
    expect(parentOrders.has(child.parentOrder)).toBe(true) // references a real parent
  })
}

describe('selectAttachmentChunkingPipeline', () => {
  it.each(['md', 'mdx', 'json', 'jsonl', 'ts', 'tsx', 'js', 'jsx', 'py', 'go'])(
    'routes .%s to the structured pipeline',
    (ext) => {
      expect(selectAttachmentChunkingPipeline(`file.${ext}`)).toBe('structured')
    }
  )

  it.each(['txt', 'pdf', 'csv', 'docx', 'unknown'])('routes .%s to the plain pipeline', (ext) => {
    expect(selectAttachmentChunkingPipeline(`file.${ext}`)).toBe('plain')
  })

  it('is case-insensitive on the extension', () => {
    expect(selectAttachmentChunkingPipeline('README.MD')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('Notes.Py')).toBe('structured')
  })

  it('falls back to plain when there is no filename or no extension', () => {
    expect(selectAttachmentChunkingPipeline(undefined)).toBe('plain')
    expect(selectAttachmentChunkingPipeline('Makefile')).toBe('plain')
  })

  it('uses the last dotted segment for multi-dot filenames', () => {
    expect(selectAttachmentChunkingPipeline('archive.tar.md')).toBe('structured')
    expect(selectAttachmentChunkingPipeline('archive.md.gz')).toBe('plain')
  })
})

describe('buildEmbeddedText', () => {
  it('prefixes with just the filename when no section/page', () => {
    expect(buildEmbeddedText({ filename: 'doc.md', text: 'body' })).toBe('[doc.md]\nbody')
  })

  it('includes the section path in the prefix', () => {
    expect(buildEmbeddedText({ filename: 'doc.md', sectionPath: 'Intro', text: 'body' })).toBe('[doc.md > Intro]\nbody')
  })

  it('includes the page range in the prefix', () => {
    expect(buildEmbeddedText({ filename: 'doc.pdf', pageRange: 'p1-2', text: 'body' })).toBe('[doc.pdf > p1-2]\nbody')
  })

  it('orders filename > section > page when all present', () => {
    expect(buildEmbeddedText({ filename: 'doc.md', sectionPath: 'Intro', pageRange: 'p3', text: 'body' })).toBe(
      '[doc.md > Intro > p3]\nbody'
    )
  })
})

describe('chunkStructuredDocument', () => {
  it('returns no parents or children for empty content', async () => {
    const result = await chunkStructuredDocument('')
    expect(result.parents).toEqual([])
    expect(result.children).toEqual([])
  })

  it('derives a section path from a markdown heading', async () => {
    const result = await chunkStructuredDocument('# Overview\n\nSome introductory prose about the system.')
    expect(result.parents.some((p) => p.sectionPath === 'Overview')).toBe(true)
    assertResultInvariants(result)
  })

  it('derives a section path from a numbered heading', async () => {
    const result = await chunkStructuredDocument('1. Introduction\n\nThe first section of the document body.')
    expect(result.parents.some((p) => p.sectionPath === 'Introduction')).toBe(true)
  })

  it('keeps a fenced code block intact within a parent', async () => {
    const content = '# Example\n\n```\nconst answer = 42\nreturn answer\n```\n'
    const result = await chunkStructuredDocument(content)
    const joined = result.parents.map((p) => p.text).join('\n')
    expect(joined).toContain('const answer = 42')
    expect(joined).toContain('```')
    assertResultInvariants(result)
  })

  it('splits an oversized headingless segment into multiple parents', async () => {
    // One long paragraph well beyond the hard cap, no blank lines or headings.
    const content = 'lorem ipsum dolor sit amet '.repeat(200) // ~5400 chars
    const result = await chunkStructuredDocument(content)
    expect(result.parents.length).toBeGreaterThan(1)
    for (const parent of result.parents) {
      // Recursive splitting caps parents at the hard cap (+ small tolerance).
      expect(parent.charCount).toBeLessThanOrEqual(PARENT_HARD_CAP_CHARS + 200)
    }
    expect(result.parents.map((p) => p.text).join(' ')).toContain('lorem')
    assertResultInvariants(result)
  })

  it('produces at least one child per parent', async () => {
    const result = await chunkStructuredDocument('# A\n\nAlpha beta gamma.\n\n# B\n\nDelta epsilon zeta.')
    expect(result.children.length).toBeGreaterThanOrEqual(result.parents.length)
    assertResultInvariants(result)
  })
})

describe('chunkPlainDocument', () => {
  it('leaves the section path undefined and orders parents sequentially', async () => {
    const content = 'The quick brown fox jumps over the lazy dog. '.repeat(120) // ~5400 chars
    const result = await chunkPlainDocument(content)
    expect(result.parents.length).toBeGreaterThan(1)
    expect(result.parents.every((p) => p.sectionPath === undefined)).toBe(true)
    assertResultInvariants(result)
  })

  it('returns no parents for empty content', async () => {
    const result = await chunkPlainDocument('')
    expect(result.parents).toEqual([])
    expect(result.children).toEqual([])
  })
})

describe('buildAttachmentChunks', () => {
  it('uses the structured pipeline for a .md file (section paths present)', async () => {
    const result = await buildAttachmentChunks('# Heading\n\nStructured body content here.', 'notes.md')
    expect(result.parents.some((p) => p.sectionPath === 'Heading')).toBe(true)
  })

  it('uses the plain pipeline for a .txt file (no section paths)', async () => {
    const result = await buildAttachmentChunks('# Not a heading here\n\nJust plain text body.', 'notes.txt')
    expect(result.parents.every((p) => p.sectionPath === undefined)).toBe(true)
    assertResultInvariants(result)
  })
})
