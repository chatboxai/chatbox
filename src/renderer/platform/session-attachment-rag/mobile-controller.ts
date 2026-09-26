import type {
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentRagDebugSnapshot,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionAttachmentSearchResult,
} from '@shared/types'
import type { SessionAttachmentRagController } from './interface'
import type { MobileLocalRagEngine } from './mobile/engine'

export class MobileSessionAttachmentRagController implements SessionAttachmentRagController {
  private engine?: MobileLocalRagEngine

  constructor(engine?: MobileLocalRagEngine) {
    this.engine = engine
  }

  public async getEngine(): Promise<MobileLocalRagEngine> {
    if (!this.engine) {
      const { MobileLocalRagEngine } = await import('./mobile/engine')
      this.engine = new MobileLocalRagEngine()
    }
    return this.engine
  }

  public async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment> {
    const engine = await this.getEngine()
    return engine.createAttachment(params)
  }

  public async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    const engine = await this.getEngine()
    return engine.getAttachments(ids)
  }

  public async retryAttachment(attachmentId: number): Promise<void> {
    const engine = await this.getEngine()
    return engine.retryAttachment(attachmentId)
  }

  public async rebindAttachment(params: {
    attachmentId: number
    sessionId: string
    messageId: string
  }): Promise<void> {
    const engine = await this.getEngine()
    return engine.rebindAttachment(params)
  }

  public async deleteAttachment(attachmentId: number): Promise<void> {
    const engine = await this.getEngine()
    return engine.deleteAttachment(attachmentId)
  }

  public async deleteMessageAttachments(messageId: string): Promise<number[]> {
    const engine = await this.getEngine()
    return engine.deleteMessageAttachments(messageId)
  }

  public async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    const engine = await this.getEngine()
    return engine.deleteSessionAttachments(sessionId)
  }

  public async cleanupOrphans(params: {
    sessionIds: string[]
    messageIds: string[]
  }): Promise<number[]> {
    const engine = await this.getEngine()
    return engine.cleanupOrphans(params)
  }

  public async getDebugSnapshot(): Promise<SessionAttachmentRagDebugSnapshot> {
    const engine = await this.getEngine()
    return engine.getDebugSnapshot()
  }

  public async clearAll(): Promise<number> {
    const engine = await this.getEngine()
    return engine.clearAll()
  }

  public async runMaintenance(
    params: SessionAttachmentRagMaintenanceScope
  ): Promise<SessionAttachmentRagMaintenanceResult> {
    const engine = await this.getEngine()
    return engine.runMaintenance(params)
  }

  public async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<SessionAttachmentSearchResult[]> {
    const engine = await this.getEngine()
    return engine.query(params)
  }

  public async readParents(params: {
    parentIds: number[]
    attachmentIds: number[]
  }): Promise<SessionAttachmentParent[]> {
    const engine = await this.getEngine()
    return engine.readParents(params)
  }
}

export default MobileSessionAttachmentRagController
