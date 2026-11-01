/** Physical filenames created by @capacitor-community/sqlite for the historical logical names. */
export const CAPACITOR_MAIN_DATABASE_FILE = 'chatboxSQLite.db'
export const CAPACITOR_SESSION_META_DATABASE_FILE = 'chatbox-session-metaSQLite.db'
export const CAPACITOR_IMAGE_GENERATION_DATABASE_FILE = 'chatbox-image-generationSQLite.db'
export const CAPACITOR_MESSAGE_ROWS_DATABASE_FILE = 'chatbox-messagesSQLite.db'

export const CAPACITOR_MAIN_KEY_VALUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS key_value (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`

export const CAPACITOR_SESSION_META_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_meta (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  starred INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  assistant_avatar_key TEXT,
  pic_url TEXT,
  background_image TEXT,
  type TEXT,
  sort_order REAL NOT NULL,
  created_at INTEGER NOT NULL,
  recovery_archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_session_meta_sort_order
ON session_meta(sort_order DESC);
`

/**
 * Partial indexes for the session list queries: hidden rows (archived, sub-agent)
 * can outnumber visible ones many times over, and these keep visible and archived
 * pages and counts from scanning them. `idx_session_meta_list` also serves one
 * folder's unpinned sessions in order, and its count, as a single index range.
 * Apply after the `session_meta` column migrations, since `archived_at` and
 * `folder_id` are added to older tables by `ALTER TABLE`.
 */
export const CAPACITOR_SESSION_META_LIST_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_session_meta_list
ON session_meta(starred, folder_id, sort_order DESC) WHERE hidden = 0;

CREATE INDEX IF NOT EXISTS idx_session_meta_archived
ON session_meta(archived_at DESC) WHERE archived_at IS NOT NULL;
`

/**
 * `ORDER BY` clause for visible `session_meta` rows in the order of
 * `sortSessionRecords`: pinned, then each folder in `folderIds` order, then
 * unfiled (including rows whose folder no longer exists), each by sort_order.
 */
export function capacitorSessionListOrderBy(folderIds: readonly string[]): { sql: string; params: string[] } {
  const folderCases = folderIds.map((_, index) => `WHEN folder_id = ? THEN ${index + 1}`).join(' ')
  return {
    sql: `CASE WHEN starred = 1 THEN 0 ${folderCases} ELSE ${folderIds.length + 1} END, sort_order DESC`,
    params: [...folderIds],
  }
}

/** Row storage keeps no foreign keys or CHECK constraints: the Capacitor and native
 * drivers disagree on the default foreign-key pragma, so `SqlSessionRowStore`
 * validates identities before every write instead. */
export const CAPACITOR_MESSAGE_ROWS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_threads (
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  threadOrder INTEGER NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  root_message_id TEXT,
  active_leaf_message_id TEXT,
  compaction_points_json TEXT NOT NULL DEFAULT '[]',
  session_prompt_context_snapshot_json TEXT,
  session_record_json TEXT,
  commit_revision INTEGER,
  projection_json TEXT,
  PRIMARY KEY (session_id, thread_id)
);

CREATE TABLE IF NOT EXISTS session_messages (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  parent_message_id TEXT,
  active_child_id TEXT,
  siblingOrder INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  branch_id TEXT,
  payload_id TEXT NOT NULL,
  message_json TEXT NOT NULL,
  payload_utf8_length INTEGER NOT NULL,
  row_metadata_json TEXT,
  PRIMARY KEY (session_id, message_id)
);

CREATE TABLE IF NOT EXISTS session_threads_staging (
  mutation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  threadOrder INTEGER NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  root_message_id TEXT,
  active_leaf_message_id TEXT,
  compaction_points_json TEXT NOT NULL DEFAULT '[]',
  session_prompt_context_snapshot_json TEXT,
  session_record_json TEXT,
  commit_revision INTEGER,
  projection_json TEXT,
  PRIMARY KEY (mutation_id, session_id, thread_id)
);

CREATE TABLE IF NOT EXISTS session_messages_staging (
  mutation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  parent_message_id TEXT,
  active_child_id TEXT,
  siblingOrder INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  branch_id TEXT,
  payload_id TEXT NOT NULL,
  message_json TEXT NOT NULL,
  payload_utf8_length INTEGER NOT NULL,
  row_metadata_json TEXT,
  PRIMARY KEY (mutation_id, session_id, message_id)
);

CREATE TABLE IF NOT EXISTS session_row_revision_guard (
  value INTEGER CONSTRAINT session_row_revision_conflict CHECK (value = 0)
);

CREATE TABLE IF NOT EXISTS session_row_heads (
  session_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER,
  mutation_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_row_staging_mutations (
  mutation_id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_row_delete_receipts (
  session_id TEXT PRIMARY KEY NOT NULL,
  mutation_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_messages_thread_sibling_order
ON session_messages(session_id, thread_id, siblingOrder);

CREATE INDEX IF NOT EXISTS idx_session_messages_status
ON session_messages(status, session_id, thread_id, message_id);

CREATE INDEX IF NOT EXISTS idx_session_messages_payload
ON session_messages(payload_id);

CREATE INDEX IF NOT EXISTS idx_session_messages_staging_payload
ON session_messages_staging(payload_id);

DELETE FROM session_row_delete_receipts
WHERE deleted_at < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 604800000;
`

export const CAPACITOR_IMAGE_GENERATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS image_generation (
  id TEXT PRIMARY KEY NOT NULL,
  prompt TEXT NOT NULL,
  reference_images TEXT NOT NULL DEFAULT '[]',
  generated_images TEXT NOT NULL DEFAULT '[]',
  generated_image_thumbnails TEXT,
  created_at INTEGER NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dalle_style TEXT,
  image_generate_num INTEGER,
  status TEXT NOT NULL,
  parent_id TEXT,
  error TEXT,
  error_code TEXT,
  error_item_uuid TEXT,
  task_id TEXT,
  aspect_ratio TEXT,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_image_generation_created_at
ON image_generation(created_at DESC);
`
