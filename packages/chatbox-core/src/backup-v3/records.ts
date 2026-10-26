import type { CopilotDetail, Settings } from '@shared/types'
import {
  collectGlobalResourceReferences,
  collectHeaderResourceReferences,
  collectMessageReferences,
  type ResourceReference,
} from '../resources'
import type {
  BackupBusinessRecord,
  BackupImportIssue,
  BackupImportIssueReporter,
  BackupManifest,
  BackupRecord,
  BackupWorkspace,
} from './types'

export function backupResourceReferences(record: BackupBusinessRecord): ResourceReference[] {
  if (record.type === 'session') return collectHeaderResourceReferences(record.session)
  if (record.type === 'message') {
    const result: ResourceReference[] = []
    collectMessageReferences(record.message.message, record.message.sessionId, result)
    return result
  }
  if (record.type === 'global' && record.category === 'settings')
    return collectGlobalResourceReferences(record.value as Partial<Settings>)
  if (record.type === 'global' && record.category === 'copilot')
    return collectGlobalResourceReferences(undefined, [record.value as CopilotDetail])
  return []
}

const orderIssueMessages = {
  'record-order': 'The record was skipped because it is outside its owning data section.',
  'selection-mismatch': 'The record was skipped because its category is outside the backup selection.',
  'missing-session': 'The record was skipped because its owning conversation is missing or out of order.',
  'missing-thread': 'The message was skipped because its owning thread is missing.',
  'duplicate-session': 'A duplicate conversation was skipped.',
  'duplicate-thread': 'A duplicate thread was skipped.',
  'duplicate-message': 'A duplicate message was skipped.',
  'duplicate-global': 'A duplicate settings record was skipped.',
  'message-identity': 'The message was skipped because its row ID and content ID do not match.',
} as const

export class RecordOrder {
  private phase: 'resource' | 'global' | 'session' | 'warning' = 'resource'
  private sessionId: string | undefined
  private messagesStarted = false
  constructor(
    private readonly workspace: BackupWorkspace,
    private readonly manifest: BackupManifest,
    private readonly onIssue?: BackupImportIssueReporter
  ) {}

  async accept(record: BackupRecord): Promise<boolean> {
    if (record.type === 'resource') {
      if (this.phase !== 'resource') return this.reject('record-order', record.resourceId)
      return true
    }
    if (record.type === 'warning') {
      if (!this.onIssue) this.phase = 'warning'
      return true
    }
    if (this.phase === 'warning') return this.reject('record-order')
    if (record.type === 'global') {
      if (this.phase === 'session') return this.reject('record-order', record.id)
      this.phase = 'global'
      const group =
        record.category === 'session-settings' || record.category === 'folder'
          ? 'sessions'
          : record.category === 'copilot' ||
              record.category === 'copilot-memory' ||
              record.category === 'memory-identities'
            ? 'copilots'
            : 'settings'
      if (!this.manifest.selection[group]) return this.reject('selection-mismatch', record.id)
      return this.unique('global-ids', JSON.stringify([record.category, record.id]), 'duplicate-global', record.id)
    }
    const sessionId =
      record.type === 'session'
        ? record.session.id
        : (record.type === 'thread' ? record.thread : record.message).sessionId
    if (!this.manifest.selection.sessions) return this.reject('selection-mismatch', sessionId, sessionId)
    this.phase = 'session'
    if (record.type === 'session') {
      if (!(await this.unique('session-ids', sessionId, 'duplicate-session', sessionId, sessionId))) {
        this.sessionId = undefined
        return false
      }
      this.sessionId = sessionId
      this.messagesStarted = false
      return true
    }
    const row = record.type === 'thread' ? record.thread : record.message
    const objectId = record.type === 'thread' ? record.thread.threadId : record.message.messageId
    if (row.sessionId !== this.sessionId) return this.reject('missing-session', objectId, row.sessionId)
    // The candidate writer validates owned rows in bounded batches before publication.
    if (this.onIssue) return true
    if (record.type === 'thread') {
      if (this.messagesStarted) return this.reject('record-order', objectId, row.sessionId)
      return this.unique(
        'thread-ids',
        JSON.stringify([row.sessionId, row.threadId]),
        'duplicate-thread',
        objectId,
        row.sessionId
      )
    }
    this.messagesStarted = true
    if (record.message.messageId !== record.message.message.id)
      return this.reject('message-identity', objectId, row.sessionId)
    if (!(await this.workspace.get('thread-ids', JSON.stringify([row.sessionId, row.threadId]))))
      return this.reject('missing-thread', objectId, row.sessionId)
    return this.unique(
      'message-ids',
      JSON.stringify([row.sessionId, objectId]),
      'duplicate-message',
      objectId,
      row.sessionId
    )
  }
  private async unique(
    table: string,
    key: string,
    code: keyof typeof orderIssueMessages,
    objectId: string,
    sessionId?: string
  ) {
    return (await this.workspace.put(table, key, '1')) || this.reject(code, objectId, sessionId)
  }
  private reject(code: keyof typeof orderIssueMessages, objectId?: string, sessionId?: string): false {
    const issue: BackupImportIssue = { code, objectId, sessionId, message: orderIssueMessages[code] }
    if (!this.onIssue) throw new Error(issue.message)
    this.onIssue(issue)
    return false
  }
}

export { toBackupMessage, toBackupSession, toBackupThread } from './schema'
