export interface MobileParentBlock {
  parentOrder: number
  sectionPath?: string
  text: string
  tokenEstimate: number
  charCount: number
}

export interface MobileChildChunk {
  parentOrder: number
  chunkOrder: number
  sectionPath?: string
  rawText: string
  tokenEstimate: number
}

export interface MobileChunkingResult {
  parents: MobileParentBlock[]
  children: MobileChildChunk[]
}

export interface MobileVectorRecord {
  chunkId: number
  attachmentId: number
  vector: number[] | Float32Array
}

export interface MobileVectorHit {
  chunkId: number
  attachmentId: number
  score: number
}
