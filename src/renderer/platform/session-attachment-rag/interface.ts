import type {
  SessionAttachment,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentSearchResult,
} from '@shared/types'

export interface SessionAttachmentRagController {
  create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment>
  getAttachments(ids: number[]): Promise<SessionAttachment[]>
  retryAttachment(attachmentId: number): Promise<void>
  rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void>
  deleteAttachment(attachmentId: number): Promise<void>
  deleteMessageAttachments(messageId: string): Promise<number[]>
  deleteSessionAttachments(sessionId: string): Promise<number[]>
  cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]>
  getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot>
  clearAll(): Promise<number>
  runMaintenance(params: SessionAttachmentRagMaintenanceScope): Promise<SessionAttachmentRagMaintenanceResult>
  query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]>
  readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]>
}
