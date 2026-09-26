import { MDocument } from '@mastra/rag'

// Sizes are CHARACTER counts. Mastra's `recursive` chunker uses `text.length` as its
// default length function, so `maxSize` is in chars, not tokens. Earlier `_TOKENS`
// names were a misnomer — actual chunks were ~1/4 of the implied tokens. Values kept
// because retrieval evals showed they recall well at this size.
// `tokenEstimate` (length / 4) is preserved for DB metadata only.
export const PARENT_TARGET_CHARS = 1600 // ≈ 400 tokens
export const PARENT_HARD_CAP_CHARS = 2400 // ≈ 600 tokens
export const CHILD_SIZE_CHARS = 448 // ≈ 112 tokens
export const CHILD_OVERLAP_CHARS = 64 // ≈ 16 tokens
export const PLAIN_PARENT_OVERLAP_CHARS = 0

export interface ParentBlock {
  parentOrder: number
  sectionPath?: string
  text: string
  tokenEstimate: number
  charCount: number
}

export interface ChildChunk {
  parentOrder: number
  chunkOrder: number
  sectionPath?: string
  rawText: string
  tokenEstimate: number
}

export interface StructuralSegment {
  text: string
  sectionPath?: string
}

export type AttachmentChunkingPipeline = 'structured' | 'plain'

export interface AttachmentChunkingResult {
  parents: ParentBlock[]
  children: ChildChunk[]
}

const STRUCTURED_CHUNKING_EXTENSIONS = new Set(['md', 'mdx', 'json', 'jsonl', 'ts', 'tsx', 'js', 'jsx', 'py', 'go'])

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

export function getFileExtension(filename?: string): string | undefined {
  if (!filename) {
    return undefined
  }
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) : undefined
}

export function isStructuredChunkingType(filename?: string): boolean {
  const extension = getFileExtension(filename)
  return extension ? STRUCTURED_CHUNKING_EXTENSIONS.has(extension) : false
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  return /^#{1,6}\s+/.test(trimmed) || /^(\d+(\.\d+)*[.)])\s+\S+/.test(trimmed)
}

function extractHeading(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(\d+(\.\d+)*[.)])\s+/, '')
    .trim()
}

function isListLine(line: string): boolean {
  return /^(\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(line)
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed.length > 2
}

function flushBlock(blocks: StructuralSegment[], lines: string[], sectionPath?: string) {
  const text = lines.join('\n').trim()
  if (text) {
    blocks.push({ text, sectionPath })
  }
}

export function splitIntoStructuralSegments(content: string): StructuralSegment[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blocks: StructuralSegment[] = []

  let currentLines: string[] = []
  let currentSectionPath: string | undefined
  let inCodeBlock = false
  let currentMode: 'default' | 'list' | 'table' = 'default'

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      if (!inCodeBlock && currentLines.length > 0) {
        flushBlock(blocks, currentLines, currentSectionPath)
        currentLines = []
      }
      currentLines.push(line)
      inCodeBlock = !inCodeBlock
      if (!inCodeBlock) {
        flushBlock(blocks, currentLines, currentSectionPath)
        currentLines = []
      }
      currentMode = 'default'
      continue
    }

    if (inCodeBlock) {
      currentLines.push(line)
      continue
    }

    if (isHeadingLine(line)) {
      if (currentLines.length > 0) {
        flushBlock(blocks, currentLines, currentSectionPath)
        currentLines = []
      }
      currentSectionPath = extractHeading(line)
      currentLines.push(line)
      currentMode = 'default'
      continue
    }

    if (!trimmed) {
      if (currentLines.length > 0) {
        flushBlock(blocks, currentLines, currentSectionPath)
        currentLines = []
      }
      currentMode = 'default'
      continue
    }

    const nextMode: 'default' | 'list' | 'table' = isTableLine(line) ? 'table' : isListLine(line) ? 'list' : 'default'
    if (currentLines.length > 0 && currentMode !== 'default' && nextMode !== currentMode) {
      flushBlock(blocks, currentLines, currentSectionPath)
      currentLines = []
    }

    currentLines.push(line)
    currentMode = nextMode
  }

  if (currentLines.length > 0) {
    flushBlock(blocks, currentLines, currentSectionPath)
  }

  return blocks
}

async function splitOversizedSegment(segment: StructuralSegment): Promise<StructuralSegment[]> {
  if (segment.text.length <= PARENT_HARD_CAP_CHARS) {
    return [segment]
  }

  const parts = await MDocument.fromText(segment.text).chunk({
    strategy: 'recursive',
    maxSize: PARENT_HARD_CAP_CHARS,
    overlap: 0,
  })

  return parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .map((text) => ({ text, sectionPath: segment.sectionPath }))
}

export async function buildStructuredSegments(content: string): Promise<StructuralSegment[]> {
  const rawSegments = splitIntoStructuralSegments(content)
  const expandedSegments: StructuralSegment[] = []
  for (const segment of rawSegments) {
    const parts = await splitOversizedSegment(segment)
    expandedSegments.push(...parts)
  }
  return expandedSegments
}

export async function buildStructuredParentBlocks(content: string): Promise<ParentBlock[]> {
  const expandedSegments = await buildStructuredSegments(content)
  const parents: ParentBlock[] = []
  let currentTextParts: string[] = []
  let currentSectionPath: string | undefined
  let currentChars = 0

  const flushParent = () => {
    const text = currentTextParts.join('\n\n').trim()
    if (!text) {
      return
    }
    parents.push({
      parentOrder: parents.length,
      sectionPath: currentSectionPath,
      text,
      tokenEstimate: estimateTokenCount(text),
      charCount: text.length,
    })
    currentTextParts = []
    currentSectionPath = undefined
    currentChars = 0
  }

  for (const segment of expandedSegments) {
    const segmentChars = segment.text.length
    const shouldFlush = currentTextParts.length > 0 && currentChars + segmentChars > PARENT_HARD_CAP_CHARS
    if (shouldFlush) {
      flushParent()
    }

    if (currentTextParts.length === 0) {
      currentSectionPath = segment.sectionPath
    }

    currentTextParts.push(segment.text)
    currentChars += segmentChars

    if (currentChars >= PARENT_TARGET_CHARS) {
      flushParent()
    }
  }

  flushParent()
  return parents
}

export async function buildPlainParentBlocks(content: string): Promise<ParentBlock[]> {
  const parts = await MDocument.fromText(content).chunk({
    strategy: 'recursive',
    maxSize: PARENT_TARGET_CHARS,
    overlap: PLAIN_PARENT_OVERLAP_CHARS,
  })

  return parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      parentOrder: index,
      sectionPath: undefined,
      text,
      tokenEstimate: estimateTokenCount(text),
      charCount: text.length,
    }))
}

export async function buildChildChunks(parents: ParentBlock[]): Promise<ChildChunk[]> {
  const children: ChildChunk[] = []

  for (const parent of parents) {
    const chunks = await MDocument.fromText(parent.text).chunk({
      strategy: 'recursive',
      maxSize: CHILD_SIZE_CHARS,
      overlap: CHILD_OVERLAP_CHARS,
    })

    for (const chunk of chunks) {
      const text = chunk.text.trim()
      if (!text) {
        continue
      }
      children.push({
        parentOrder: parent.parentOrder,
        chunkOrder: children.length,
        sectionPath: parent.sectionPath,
        rawText: text,
        tokenEstimate: estimateTokenCount(text),
      })
    }
  }

  return children
}

export async function buildChunkingResult(parents: ParentBlock[]): Promise<AttachmentChunkingResult> {
  const children = await buildChildChunks(parents)
  return { parents, children }
}

export async function chunkStructuredDocument(content: string): Promise<AttachmentChunkingResult> {
  const parents = await buildStructuredParentBlocks(content)
  return buildChunkingResult(parents)
}

export async function chunkPlainDocument(content: string): Promise<AttachmentChunkingResult> {
  const parents = await buildPlainParentBlocks(content)
  return buildChunkingResult(parents)
}

export function selectAttachmentChunkingPipeline(filename?: string): AttachmentChunkingPipeline {
  return isStructuredChunkingType(filename) ? 'structured' : 'plain'
}

export async function buildAttachmentChunks(content: string, filename?: string): Promise<AttachmentChunkingResult> {
  const pipeline = selectAttachmentChunkingPipeline(filename)
  return pipeline === 'structured' ? chunkStructuredDocument(content) : chunkPlainDocument(content)
}

export function buildEmbeddedText(params: {
  filename: string
  sectionPath?: string
  pageRange?: string
  text: string
}): string {
  const prefixParts = [params.filename]
  if (params.sectionPath) {
    prefixParts.push(params.sectionPath)
  }
  if (params.pageRange) {
    prefixParts.push(params.pageRange)
  }
  return `[${prefixParts.join(' > ')}]\n${params.text}`
}
