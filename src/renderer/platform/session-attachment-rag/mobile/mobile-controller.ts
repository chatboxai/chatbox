import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
} from '@shared/types'
import type { SessionAttachmentRagController } from '../interface'
import { MobileLocalRagEngine } from './engine'

export class MobileSessionAttachmentRagController implements SessionAttachmentRagController {
  private engine: MobileLocalRagEngine

  constructor(engine?: MobileLocalRagEngine) {
    this.engine = engine ?? new MobileLocalRagEngine()
  }

  async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment> {
    return this.engine.createAttachment(params)
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    return this.engine.getAttachments(ids)
  }

  async retryAttachment(attachmentId: number): Promise<void> {
    return this.engine.retryAttachment(attachmentId)
  }

  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> {
    return this.engine.rebindAttachment(params)
  }

  async deleteAttachment(attachmentId: number): Promise<void> {
    return this.engine.deleteAttachment(attachmentId)
  }

  async deleteMessageAttachments(messageId: string): Promise<number[]> {
    return this.engine.deleteMessageAttachments(messageId)
  }

  async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    return this.engine.deleteSessionAttachments(sessionId)
  }

  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> {
    return this.engine.cleanupOrphans(params)
  }

  async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    return this.engine.getDebugSnapshot()
  }

  async clearAll(): Promise<number> {
    return this.engine.clearAll()
  }

  async runMaintenance(params: SessionAttachmentRagMaintenanceScope): Promise<SessionAttachmentRagMaintenanceResult> {
    return this.engine.runMaintenance(params)
  }

  async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]> {
    return this.engine.query(params)
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]> {
    return this.engine.readParents(params)
  }
}

export default MobileSessionAttachmentRagController
