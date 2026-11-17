import type { MessageRowMetadata } from '../session/session-tree/types'

export const SESSION_ROW_PROJECTION_SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS session_row_local_metadata(mutation_id TEXT NOT NULL,message_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(mutation_id,message_id));
 CREATE TABLE IF NOT EXISTS session_row_local_deletes(mutation_id TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(mutation_id,session_id,message_id));
 CREATE INDEX IF NOT EXISTS idx_session_messages_children ON session_messages(session_id,thread_id,parent_message_id,siblingOrder,message_id);
 CREATE INDEX IF NOT EXISTS idx_session_messages_branch ON session_messages(session_id,thread_id,parent_message_id,branch_id,siblingOrder,message_id);
`

export function rowExtra(row: MessageRowMetadata): string | null {
  const { facts, forkCreatedAt, pendingBranchId, pendingBranchOrder, forkPivotId, fork } = row
  if (
    facts === undefined &&
    forkCreatedAt === undefined &&
    pendingBranchId === undefined &&
    pendingBranchOrder === undefined &&
    forkPivotId === undefined &&
    fork === undefined
  )
    return null
  return JSON.stringify({ facts, forkCreatedAt, pendingBranchId, pendingBranchOrder, forkPivotId, fork })
}

export function parseRowExtra(
  value: string | null | undefined
): Pick<
  MessageRowMetadata,
  'facts' | 'forkCreatedAt' | 'pendingBranchId' | 'pendingBranchOrder' | 'forkPivotId' | 'fork'
> {
  return value ? JSON.parse(value) : {}
}
