import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { ImageGeneration, ImageGenerationPage, SessionAttachment } from '@shared/types'
import type { KnowledgeBaseController } from '@/platform/knowledge-base/interface'
import type { SessionAttachmentRagController } from '@/platform/session-attachment-rag/interface'
import TestPlatform from '@/platform/test_platform'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'

class DemoImageGenerationStorage implements ImageGenerationStorage {
  private readonly records = new Map<string, ImageGeneration>()

  async initialize(): Promise<void> {}

  async create(record: ImageGeneration): Promise<void> {
    this.records.set(record.id, {
      ...record,
      generatedImages: [...record.generatedImages],
      referenceImages: [...record.referenceImages],
    })
  }

  async update(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | null> {
    const current = this.records.get(id)
    if (!current) return null
    const next: ImageGeneration = {
      ...current,
      ...updates,
      generatedImages: updates.generatedImages ? [...updates.generatedImages] : [...current.generatedImages],
      referenceImages: updates.referenceImages ? [...updates.referenceImages] : [...current.referenceImages],
    }
    this.records.set(id, next)
    return next
  }

  async getById(id: string): Promise<ImageGeneration | null> {
    const record = this.records.get(id)
    return record
      ? { ...record, generatedImages: [...record.generatedImages], referenceImages: [...record.referenceImages] }
      : null
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }

  async getPage(cursor: number, limit = 20): Promise<ImageGenerationPage> {
    const items = [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt)
    const pageItems = items.slice(cursor, cursor + limit)
    return {
      items: pageItems.map((record) => ({
        ...record,
        generatedImages: [...record.generatedImages],
        referenceImages: [...record.referenceImages],
      })),
      nextCursor: cursor + pageItems.length < items.length ? cursor + pageItems.length : null,
      total: items.length,
    }
  }

  async getTotal(): Promise<number> {
    return this.records.size
  }
}

class DemoSessionMetaStorage implements SessionMetaStorage {
  private readonly repo = new InMemorySessionRepository()

  initialize() {
    return this.repo.meta.initialize()
  }
  create(record: Parameters<SessionMetaStorage['create']>[0]) {
    return this.repo.meta.create(record)
  }
  createMany(records: Parameters<SessionMetaStorage['createMany']>[0]) {
    return this.repo.meta.createMany(records)
  }
  update(id: string, updates: Parameters<SessionMetaStorage['update']>[1]) {
    return this.repo.meta.update(id, updates)
  }
  getById(id: string) {
    return this.repo.meta.getById(id)
  }
  delete(id: string) {
    return this.repo.meta.delete(id)
  }
  deleteMany(ids: string[]) {
    return this.repo.meta.deleteMany(ids)
  }
  getAll() {
    return this.repo.meta.getAll()
  }
  getAllIncludingHidden() {
    return this.repo.meta.getAllIncludingHidden()
  }
  getArchived() {
    return this.repo.meta.getArchived()
  }
  getArchivedPage(cursor: number, limit?: number) {
    return this.repo.meta.getArchivedPage(cursor, limit)
  }
  getPage(cursor: number, limit?: number) {
    return this.repo.meta.getPage(cursor, limit)
  }
  getTotal() {
    return this.repo.meta.getTotal()
  }
  getAllTotal() {
    return this.repo.meta.getAllTotal()
  }
  getArchivedTotal() {
    return this.repo.meta.getArchivedTotal()
  }
  clear() {
    return this.repo.meta.clear()
  }
}

const knowledgeBaseController: KnowledgeBaseController = {
  list: async () => [],
  create: async () => undefined,
  delete: async () => undefined,
  listFiles: async () => [],
  countFiles: async () => 0,
  listFilesPaginated: async () => [],
  uploadFile: async () => undefined,
  deleteFile: async () => undefined,
  retryFile: async () => undefined,
  pauseFile: async () => undefined,
  resumeFile: async () => undefined,
  search: async () => [],
  update: async () => undefined,
  getFilesMeta: async () => [],
  readFileChunks: async () => [],
  testMineruConnection: async () => ({ success: false, error: 'unavailable in marketing demo' }),
}

function unusedAttachment(params: {
  sessionId: string
  messageId: string
  attachmentStorageKey: string
  filename: string
  mimeType: string
  fileSize: number
  tokenEstimate: number
  parserType?: string
}): SessionAttachment {
  return {
    id: 0,
    sessionId: params.sessionId,
    messageId: params.messageId,
    attachmentStorageKey: params.attachmentStorageKey,
    filename: params.filename,
    mimeType: params.mimeType,
    fileSize: params.fileSize,
    tokenEstimate: params.tokenEstimate,
    parserType: params.parserType,
    availability: 'allowed',
    status: 'ready',
    indexStatus: 'ready',
  }
}

const sessionAttachmentRagController: SessionAttachmentRagController = {
  create: async (params) => unusedAttachment(params),
  getAttachments: async () => [],
  retryAttachment: async () => undefined,
  rebindAttachment: async () => undefined,
  deleteAttachment: async () => undefined,
  deleteMessageAttachments: async () => [],
  deleteSessionAttachments: async () => [],
  cleanupOrphans: async () => [],
  getDebugSnapshot: async () => ({
    dbPath: '',
    dbSizeBytes: 0,
    vectorDbPath: '',
    vectorDbSizeBytes: 0,
    attachmentCount: 0,
    parentCount: 0,
    chunkCount: 0,
    vectorIndexNames: [],
    statusCounts: { pending: 0, indexing: 0, ready: 0, failed: 0 },
    recentAttachments: [],
  }),
  clearAll: async () => 0,
  runMaintenance: async () => ({
    interruptedFailedCount: 0,
    canceledPurgedCount: 0,
    orphanDeletedIds: [],
  }),
  query: async () => [],
  readParents: async () => [],
}

class DemoPlatform extends TestPlatform {
  public override readonly type = 'web' as const
  public override readonly isDesktopLike = false

  private readonly imageGenerationStorage = new DemoImageGenerationStorage()
  private readonly sessionMetaStorage = new DemoSessionMetaStorage()

  public override trackingEvent(): void {}

  public override async appLog(): Promise<void> {}

  public override getKnowledgeBaseController(): KnowledgeBaseController {
    return knowledgeBaseController
  }

  public override getSessionAttachmentRagController(): SessionAttachmentRagController {
    return sessionAttachmentRagController
  }

  public override getImageGenerationStorage(): ImageGenerationStorage {
    return this.imageGenerationStorage
  }

  public override getSessionMetaStorage(): SessionMetaStorage {
    return this.sessionMetaStorage
  }
}

const demoPlatform = new DemoPlatform()
export default demoPlatform
