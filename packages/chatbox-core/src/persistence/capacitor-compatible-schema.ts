/** Physical filenames created by @capacitor-community/sqlite for the historical logical names. */
export const CAPACITOR_MAIN_DATABASE_FILE = 'chatboxSQLite.db'
export const CAPACITOR_SESSION_META_DATABASE_FILE = 'chatbox-session-metaSQLite.db'
export const CAPACITOR_IMAGE_GENERATION_DATABASE_FILE = 'chatbox-image-generationSQLite.db'

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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_meta_sort_order
ON session_meta(sort_order DESC);
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
