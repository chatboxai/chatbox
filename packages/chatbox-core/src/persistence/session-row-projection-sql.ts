import type { SessionRows } from '../ports/session-row-store'
import type { MessageRowMetadata } from '../session/session-tree/types'

export const SESSION_ROW_PROJECTION_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS session_row_local_metadata(mutation_id TEXT NOT NULL,message_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(mutation_id,message_id));
    CREATE TABLE IF NOT EXISTS session_row_selected_paths(mutation_id TEXT NOT NULL,message_id TEXT NOT NULL,depth INTEGER NOT NULL,PRIMARY KEY(mutation_id,message_id));
    CREATE TABLE IF NOT EXISTS session_row_local_versions(mutation_id TEXT NOT NULL,payload_id TEXT NOT NULL,PRIMARY KEY(mutation_id,payload_id));
    CREATE TABLE IF NOT EXISTS session_row_local_deletes (mutation_id TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(mutation_id,session_id,message_id));
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_local_children ON session_messages_staging(mutation_id,session_id,thread_id,parent_message_id,seq,message_id);
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_selected ON session_messages_staging(mutation_id,session_id,thread_id,selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected_naming ON session_messages(session_id,thread_id,json_extract(row_metadata_json,'$.facts.role'),selected_depth) WHERE selected_depth IS NOT NULL AND json_extract(row_metadata_json,'$.facts.autoTitleEligible')=1;
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_selected_naming ON session_messages_staging(mutation_id,session_id,thread_id,json_extract(row_metadata_json,'$.facts.role'),selected_depth) WHERE selected_depth IS NOT NULL AND json_extract(row_metadata_json,'$.facts.autoTitleEligible')=1;
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected_role ON session_messages(session_id,thread_id,json_extract(row_metadata_json,'$.facts.role'),selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected_kind ON session_messages(session_id,thread_id,kind,selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_selected_role ON session_messages_staging(mutation_id,session_id,thread_id,json_extract(row_metadata_json,'$.facts.role'),selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_selected_kind ON session_messages_staging(mutation_id,session_id,thread_id,kind,selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected_paused ON session_messages(session_id,thread_id,json_extract(row_metadata_json,'$.facts.paused'),selected_depth) WHERE selected_depth IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected_conversation ON session_messages(session_id,thread_id,selected_depth) WHERE selected_depth IS NOT NULL AND kind<>'summary' AND json_extract(row_metadata_json,'$.facts.role')<>'system' AND COALESCE(json_extract(row_metadata_json,'$.facts.isForkMarker'),0)=0;
    CREATE INDEX IF NOT EXISTS idx_session_messages_staging_selected_conversation ON session_messages_staging(mutation_id,session_id,thread_id,selected_depth) WHERE selected_depth IS NOT NULL AND kind<>'summary' AND json_extract(row_metadata_json,'$.facts.role')<>'system' AND COALESCE(json_extract(row_metadata_json,'$.facts.isForkMarker'),0)=0;
    CREATE INDEX IF NOT EXISTS idx_session_messages_children ON session_messages(session_id,thread_id,parent_message_id,seq,message_id);
    CREATE INDEX IF NOT EXISTS idx_session_messages_branch ON session_messages(session_id,thread_id,parent_message_id,branch_id,seq,message_id);
    CREATE INDEX IF NOT EXISTS idx_session_messages_selected ON session_messages(session_id,thread_id,selected_depth) WHERE selected_depth IS NOT NULL;
`

export function rowExtra(row: MessageRowMetadata): string | null {
  const { facts, selected, forkCreatedAt, pendingBranchId, pendingBranchSeq, forkPivotId, fork } = row
  if (
    facts === undefined &&
    selected === undefined &&
    forkCreatedAt === undefined &&
    pendingBranchId === undefined &&
    pendingBranchSeq === undefined &&
    forkPivotId === undefined &&
    fork === undefined
  )
    return null
  return JSON.stringify({ facts, selected, forkCreatedAt, pendingBranchId, pendingBranchSeq, forkPivotId, fork })
}

export function parseRowExtra(
  value: string | null | undefined
): Pick<
  MessageRowMetadata,
  'facts' | 'selected' | 'forkCreatedAt' | 'pendingBranchId' | 'pendingBranchSeq' | 'forkPivotId' | 'fork'
> {
  return value ? JSON.parse(value) : {}
}

/** Full replacement already owns these rows; this pass reads relationships and never touches payloads. */
export function selectedDepths(
  rows: Pick<SessionRows, 'threads'> & { messages: MessageRowMetadata[] }
): Map<string, number> {
  const selected = new Map<string, number>()
  if (!rows.messages.some((row) => row.selected !== undefined)) return selected
  const byId = new Map(rows.messages.map((row) => [row.messageId, row]))
  for (const thread of rows.threads) {
    let id = thread.rootMessageId
    let parent: string | null = null
    let depth = 0
    while (id !== null) {
      const row = byId.get(id)
      if (!row || row.threadId !== thread.threadId || row.parentMessageId !== parent || selected.has(id))
        throw new Error('Invalid selected row path')
      if (row.selected !== undefined) selected.set(id, depth)
      if (depth++ > rows.messages.length) throw new Error('Cyclic selected row path')
      parent = id
      id = row.activeChildId
    }
  }
  return selected
}
