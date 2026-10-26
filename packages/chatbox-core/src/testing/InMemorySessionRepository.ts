import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../application/session/SessionRowWriteQueue'
import { convertLegacyTreeToRowFormat } from '../application/session/compatibility/row-format'
import { decodeSessionTree } from '../session/session-tree/decode'
import { encodeSessionTree } from '../session/session-tree/encode'
import { InMemorySessionRecordStore } from './InMemorySessionRecordStore'
import { InMemorySessionRowStore } from './InMemorySessionRowStore'
import type { SessionRepositoryPort } from '../ports'
import type { Session, SessionMetaPage, SessionMetaRecord } from '../types'
import { sortSessionRecords } from '../utils/session-sort'

function page(items: SessionMetaRecord[], cursor: number, limit: number): SessionMetaPage {
  const pageItems = items.slice(cursor, cursor + limit)
  return {
    items: pageItems,
    nextCursor: cursor + pageItems.length < items.length ? cursor + pageItems.length : null,
    total: items.length,
  }
}

export class InMemorySessionRepository implements SessionRepositoryPort {
  readonly records = new Map<string, SessionMetaRecord>()
  initializeCount = 0

  readonly rowStore = new InMemorySessionRowStore()
  readonly recordStore = new InMemorySessionRecordStore()
  private readonly data = new RowBackedSessionRepository({
    rows: this.rowStore,
    records: this.recordStore,
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })

  readonly readPreviousUserMessage = this.data.readPreviousUserMessage.bind(this.data)
  readonly readSessionPromptCacheDecision = this.data.readSessionPromptCacheDecision.bind(this.data)
  readonly readSessionNamingMessages = this.data.readSessionNamingMessages.bind(this.data)
  readonly getSessionHeader = this.data.getSessionHeader.bind(this.data)
  readonly iterateSessionResourceReferences = this.data.iterateSessionResourceReferences.bind(this.data)
  readonly iterateSessionAttachmentFacts = this.data.iterateSessionAttachmentFacts.bind(this.data)
  readonly readSessionGeneratingMessageIds = this.data.readSessionGeneratingMessageIds.bind(this.data)
  readonly readSessionGenerationControl = this.data.readSessionGenerationControl.bind(this.data)
  readonly getCurrentThreadIdentity = this.data.getCurrentThreadIdentity.bind(this.data)
  readonly projectLatestSession = this.data.projectLatestSession.bind(this.data)
  readonly projectSessionMetadata = this.data.projectSessionMetadata.bind(this.data)
  readonly readSessionBranchPreview = this.data.readSessionBranchPreview.bind(this.data)
  readonly readSessionBranchMessagesPage = this.data.readSessionBranchMessagesPage.bind(this.data)
  readonly readSessionSearchWindow = this.data.readSessionSearchWindow.bind(this.data)
  readonly readSessionSearchCandidates = this.data.readSessionSearchCandidates.bind(this.data)
  readonly readSessionTranscriptWindow = this.data.readSessionTranscriptWindow.bind(this.data)
  readonly readSessionThread = this.data.readSessionThread.bind(this.data)
  readonly readSessionThreadSummariesPage = this.data.readSessionThreadSummariesPage.bind(this.data)
  readonly readSessionForkOptionsPage = this.data.readSessionForkOptionsPage.bind(this.data)
  readonly readSessionConversationState = this.data.readSessionConversationState.bind(this.data)
  readonly readSessionMessages = this.data.readSessionMessages.bind(this.data)
  readonly iterateSessionArtifactMarkdown = this.data.iterateSessionArtifactMarkdown.bind(this.data)
  readonly getSessionContextSource = this.data.getSessionContextSource.bind(this.data)
  readonly acceptSessionTokenCacheResults = this.data.acceptSessionTokenCacheResults.bind(this.data)
  readonly createSessionTokenPlan = this.data.createSessionTokenPlan.bind(this.data)
  readonly readSessionTokenPage = this.data.readSessionTokenPage.bind(this.data)
  readonly acceptSessionTextTokenResults = this.data.acceptSessionTextTokenResults.bind(this.data)
  readonly patchSessionMessageDerivedData = this.data.patchSessionMessageDerivedData.bind(this.data)
  readonly copySessionRows = this.data.copySessionRows.bind(this.data)
  readonly copySessionThreadRows = this.data.copySessionThreadRows.bind(this.data)
  readonly createSessionRows = this.data.createSessionRows.bind(this.data)
  readonly executeSessionCommand = this.data.executeSessionCommand.bind(this.data)
  readonly deleteSession = this.data.deleteSession.bind(this.data)
  readonly getAllSessionIds = this.data.getAllSessionIds.bind(this.data)

  readonly meta = {
    initialize: () => this.initializeMeta(),
    create: (record: SessionMetaRecord) => this.createMeta(record),
    createMany: (records: SessionMetaRecord[]) => this.createMetaMany(records),
    update: (id: string, updates: Partial<SessionMetaRecord>) => this.updateMeta(id, updates),
    getById: (id: string) => Promise.resolve(this.records.get(id) ?? null),
    delete: (id: string) => this.deleteMeta(id),
    deleteMany: (ids: string[]) => this.deleteMetaMany(ids),
    getAll: () => Promise.resolve(sortSessionRecords([...this.records.values()])),
    getAllIncludingHidden: () => Promise.resolve([...this.records.values()].sort((a, b) => b.sortOrder - a.sortOrder)),
    getArchived: () => Promise.resolve(this.getArchivedRecords()),
    getArchivedPage: (cursor: number, limit = 2) => Promise.resolve(page(this.getArchivedRecords(), cursor, limit)),
    getPage: (cursor: number, limit = 2, folderIds: readonly string[] = []) =>
      Promise.resolve(page(sortSessionRecords([...this.records.values()], folderIds), cursor, limit)),
    getTotal: () => Promise.resolve(sortSessionRecords([...this.records.values()]).length),
    getAllTotal: () => Promise.resolve(this.records.size),
    getArchivedTotal: () => Promise.resolve(this.getArchivedRecords().length),
    clear: () => {
      this.records.clear()
      return Promise.resolve()
    },
  }

  async initialize(): Promise<void> {
    await this.data.initialize()
    await this.meta.initialize()
  }

  /** Test fixture import; production operations use row commands. */
  async seedSession(session: Session): Promise<void> {
    await this.data.initialize()
    const encoded = encodeSessionTree(session, { activeThreadId: session.id, now: 1 })
    if (!encoded.ok) throw new Error(encoded.reason)
    const tree = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
    const previousRevision = await this.rowStore.getRevision(session.id)
    await this.rowStore.writeRows(
      {
        record: tree.session,
        revision: (previousRevision ?? 0) + 1,
        rows: { sessionId: session.id, threads: tree.threads, messages: tree.messages },
      },
      previousRevision
    )
  }

  /** Test-only DTO projection for assertions and archive fixtures. */
  inspectSession(sessionId: string): Session | null {
    const snapshot = this.rowStore.snapshot().find((entry) => entry.record.id === sessionId)
    if (!snapshot) return null
    const decoded = decodeSessionTree({ session: snapshot.record, ...snapshot.rows })
    if (!decoded.ok) throw new Error(decoded.reason)
    return decoded.session
  }

  private initializeMeta(): Promise<void> {
    this.initializeCount += 1
    return Promise.resolve()
  }

  private createMeta(record: SessionMetaRecord): Promise<void> {
    this.records.set(record.id, record)
    return Promise.resolve()
  }

  private createMetaMany(records: SessionMetaRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record)
    return Promise.resolve()
  }

  private updateMeta(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    const current = this.records.get(id)
    if (!current) return Promise.resolve(null)
    const updated = { ...current, ...updates }
    this.records.set(id, updated)
    return Promise.resolve(updated)
  }

  private deleteMeta(id: string): Promise<void> {
    this.records.delete(id)
    return Promise.resolve()
  }

  private deleteMetaMany(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id)
    return Promise.resolve()
  }

  private getArchivedRecords(): SessionMetaRecord[] {
    return [...this.records.values()]
      .filter((record) => record.archivedAt !== undefined)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  }
}

export function createTestSession(id: string): Session {
  return {
    id,
    name: id,
    type: 'chat',
    messages: [],
  }
}

export function createTestRecord(session: Session, sortOrder: number): SessionMetaRecord {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    sortOrder,
    createdAt: sortOrder,
  }
}
