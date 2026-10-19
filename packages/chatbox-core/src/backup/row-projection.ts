import { convertRowMetadataToFormat } from '../application/session/compatibility/row-format'
import { deriveMessageFacts } from '../session/message-facts'
import type { MessageRowMetadata, SessionMessageFacts, SessionRecordV2, ThreadRow } from '../session/session-tree/types'
import type { BackupRow } from './session-port'

/** A bounded conversion index holds relationships and facts while payloads remain in candidate storage. */
export class BackupRowProjectionBuilder {
  private record?: SessionRecordV2
  private threads: ThreadRow[] = []
  private messages: Array<MessageRowMetadata & { facts: SessionMessageFacts }> = []
  private bytes = 0
  append(row: BackupRow, facts?: SessionMessageFacts): BackupRow {
    let entry: unknown
    if (row.kind === 'header') {
      if (this.record) throw new Error('Duplicate candidate header')
      this.record = row.record
      entry = row.record
    } else if (row.kind === 'thread') {
      this.threads.push(row.thread)
      entry = row.thread
    } else {
      const { message, ...metadata } = row.message
      const projected = { ...metadata, facts: facts ?? deriveMessageFacts(message) }
      this.messages.push(projected)
      entry = projected
      row = { ...row, message: { ...row.message, ...projected } }
    }
    this.bytes += new TextEncoder().encode(JSON.stringify(entry)).length
    if (this.bytes > 16 * 1024 * 1024) throw new Error('Backup conversion index exceeds budget')
    return row
  }
  finish() {
    if (!this.record) throw new Error('Backup candidate header is missing')
    return convertRowMetadataToFormat({ session: this.record, threads: this.threads, messages: this.messages })
  }
}
