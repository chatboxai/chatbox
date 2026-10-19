import type {
  SessionTokenCacheEntry,
  SessionTokenCacheRequest,
  SessionTokenCacheResult,
} from '../ports/session-token-cache'
import { validTokenCachedValue, validTokenCacheResult } from '../ports/session-token-cache'
import type { SessionRowSqlDatabase } from './session-row-sql'

export const SESSION_TOKEN_CACHE_SQL = `
CREATE TABLE IF NOT EXISTS session_token_cache (
 session_id TEXT NOT NULL, message_id TEXT NOT NULL, payload_id TEXT NOT NULL, cache_key TEXT NOT NULL,
 text_tokens REAL NOT NULL, attachment_tokens REAL NOT NULL, tool_tokens REAL NOT NULL, approximate INTEGER NOT NULL,
 PRIMARY KEY(session_id,message_id,cache_key)
);
CREATE TRIGGER IF NOT EXISTS session_token_cache_delete AFTER DELETE ON session_messages
BEGIN DELETE FROM session_token_cache WHERE session_id=OLD.session_id AND message_id=OLD.message_id; END;
CREATE TRIGGER IF NOT EXISTS session_token_cache_payload AFTER UPDATE OF payload_id ON session_messages
WHEN NEW.payload_id<>OLD.payload_id
BEGIN DELETE FROM session_token_cache WHERE session_id=NEW.session_id AND message_id=NEW.message_id; END;
`
export async function readSqlTokenCache(
  database: SessionRowSqlDatabase,
  request: SessionTokenCacheRequest
): Promise<SessionTokenCacheEntry[]> {
  const ids = [...new Set(request.messageIds)]
  if (!ids.length) return []
  const rows = await database.query<{
    message_id: string
    payload_id: string
    payload_utf8_length: number
    text_tokens: number | null
    attachment_tokens: number | null
    tool_tokens: number | null
    approximate: number | null
  }>(
    `WITH requested(id,position) AS (VALUES ${ids.map((_, index) => `(?,${index})`).join(',')})
    SELECT m.message_id,m.payload_id,m.payload_utf8_length,c.text_tokens,c.attachment_tokens,c.tool_tokens,c.approximate
    FROM requested JOIN session_messages m ON m.message_id=requested.id
    LEFT JOIN session_token_cache c ON c.session_id=m.session_id AND c.message_id=m.message_id AND c.payload_id=m.payload_id AND c.cache_key=?
    WHERE m.session_id=? ORDER BY requested.position`,
    [...ids, request.cacheKey, request.sessionId]
  )
  return rows.map((row) => {
    const value =
      row.text_tokens === null
        ? undefined
        : {
            text: row.text_tokens,
            attachments: row.attachment_tokens!,
            toolCalls: row.tool_tokens!,
            approximate: row.approximate === 1,
          }
    return {
      sessionId: request.sessionId,
      messageId: row.message_id,
      payloadId: row.payload_id,
      payloadBytes: row.payload_utf8_length,
      ...(value && validTokenCachedValue(value) ? { value } : {}),
    }
  })
}
export async function acceptSqlTokenCache(
  database: SessionRowSqlDatabase,
  results: readonly SessionTokenCacheResult[]
): Promise<void> {
  if (results.length > 16) throw new Error('Token cache write exceeds page size')
  const valid = results.filter(validTokenCacheResult)
  if (!valid.length) return
  await database.executeBatch(
    valid.map(({ identity, cacheKey, value }) => ({
      sql: `INSERT INTO session_token_cache(session_id,message_id,payload_id,cache_key,text_tokens,attachment_tokens,tool_tokens,approximate)
      SELECT session_id,message_id,payload_id,?,?,?,?,? FROM session_messages WHERE session_id=? AND message_id=? AND payload_id=?
      ON CONFLICT(session_id,message_id,cache_key) DO UPDATE SET payload_id=excluded.payload_id,text_tokens=excluded.text_tokens,
      attachment_tokens=excluded.attachment_tokens,tool_tokens=excluded.tool_tokens,approximate=excluded.approximate
      WHERE session_token_cache.payload_id<>excluded.payload_id OR excluded.approximate<=session_token_cache.approximate`,
      params: [
        cacheKey,
        value.text,
        value.attachments,
        value.toolCalls,
        Number(value.approximate),
        identity.sessionId,
        identity.messageId,
        identity.payloadId,
      ],
    }))
  )
}
