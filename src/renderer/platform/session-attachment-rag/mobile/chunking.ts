import type { MobileChildChunk, MobileChunkingResult, MobileParentBlock } from './types'

const PARENT_TARGET_CHARS = 1600
const PARENT_HARD_CAP_CHARS = 2400
const CHILD_SIZE_CHARS = 448
const CHILD_OVERLAP_CHARS = 64

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

function recursiveSplitText(
  text: string,
  maxSize: number,
  overlap: number,
  separators: string[] = ['\n\n', '\n', '。', '. ', '；', '; ', ' ', '']
): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxSize) {
    return trimmed ? [trimmed] : []
  }

  let selectedSep = separators.at(-1) ?? ''
  for (const sep of separators) {
    if (sep === '' || trimmed.includes(sep)) {
      selectedSep = sep
      break
    }
  }

  const rawSplits = selectedSep ? trimmed.split(selectedSep) : Array.from(trimmed)
  const chunks: string[] = []
  let current = ''

  const remainingSeparators = separators.slice(separators.indexOf(selectedSep) + 1)

  for (const piece of rawSplits) {
    const candidate = current ? `${current}${selectedSep}${piece}` : piece
    if (candidate.length <= maxSize) {
      current = candidate
    } else {
      if (current) {
        chunks.push(current.trim())
        if (overlap > 0 && current.length > overlap) {
          const overlapText = current.slice(current.length - overlap)
          current = `${overlapText}${selectedSep}${piece}`
          continue
        }
      }

      if (piece.length > maxSize && remainingSeparators.length > 0) {
        const subPieces = recursiveSplitText(piece, maxSize, overlap, remainingSeparators)
        for (const sub of subPieces) {
          chunks.push(sub.trim())
        }
        current = ''
      } else {
        current = piece
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks.filter(Boolean)
}

export function buildMobileParentBlocks(content: string): MobileParentBlock[] {
  const paragraphs = content.split(/\n\s*\n/)
  const parents: MobileParentBlock[] = []
  let currentText = ''

  const flush = () => {
    const text = currentText.trim()
    if (text) {
      parents.push({
        parentOrder: parents.length,
        text,
        tokenEstimate: estimateTokenCount(text),
        charCount: text.length,
      })
    }
    currentText = ''
  }

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    if (trimmed.length > PARENT_HARD_CAP_CHARS) {
      flush()
      const subChunks = recursiveSplitText(trimmed, PARENT_TARGET_CHARS, 0)
      for (const sub of subChunks) {
        parents.push({
          parentOrder: parents.length,
          text: sub,
          tokenEstimate: estimateTokenCount(sub),
          charCount: sub.length,
        })
      }
      continue
    }

    if (currentText.length + trimmed.length > PARENT_TARGET_CHARS && currentText.length > 0) {
      flush()
    }

    currentText = currentText ? `${currentText}\n\n${trimmed}` : trimmed
  }

  flush()
  return parents
}

export function buildMobileChildChunks(parents: MobileParentBlock[]): MobileChildChunk[] {
  const children: MobileChildChunk[] = []

  for (const parent of parents) {
    const pieces = recursiveSplitText(parent.text, CHILD_SIZE_CHARS, CHILD_OVERLAP_CHARS)
    for (const piece of pieces) {
      children.push({
        parentOrder: parent.parentOrder,
        chunkOrder: children.length,
        rawText: piece,
        tokenEstimate: estimateTokenCount(piece),
      })
    }
  }

  return children
}

export function chunkMobileDocument(content: string): MobileChunkingResult {
  const parents = buildMobileParentBlocks(content)
  const children = buildMobileChildChunks(parents)
  return { parents, children }
}
