// Cross-session full-text chat search (FABLE F4).
// Bump the version when the FTS schema or the indexed-text extraction changes:
// the backfill meta key is namespaced by it, so a bump triggers a full re-index.
export const CHAT_SEARCH_SCHEMA_VERSION = 1
export const CHAT_SEARCH_BACKFILL_META_KEY = `backfill_done_v${CHAT_SEARCH_SCHEMA_VERSION}`
