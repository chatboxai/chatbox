import type {
  CreateSessionAttachmentParams,
  SessionAttachmentChunkRecord,
  SessionAttachmentParentRecord,
  SessionAttachmentRecord,
  SessionAttachmentStatus,
  SessionAttachmentIndexingStage,
} from '@shared/session-attachment-rag/types'
import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
} from '@shared/types'

export type {
  CreateSessionAttachmentParams,
  SessionAttachmentChunkRecord,
  SessionAttachmentParentRecord,
  SessionAttachmentRecord,
  SessionAttachmentStatus,
  SessionAttachmentIndexingStage,
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
}

export interface VectorRecord {
  chunkId: number
  attachmentId: number
  vector: number[] | Float32Array
}

export interface VectorHit {
  chunkId: number
  attachmentId: number
  score: number
}

export interface LocalVectorStore {
  createIndex(attachmentId: number, dimension: number): Promise<void>
  upsert(records: VectorRecord[]): Promise<void>
  query(params: { attachmentIds: number[]; queryVector: number[]; topK: number }): Promise<VectorHit[]>
  deleteIndex(attachmentId: number): Promise<void>
  clearAll(): Promise<void>
}
