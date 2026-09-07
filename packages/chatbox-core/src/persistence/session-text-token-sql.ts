import {
  getSessionMessageTokenizationText,
  getTokenizationTextDigest,
} from '../application/session/message-derived-data'
import {
  SESSION_TEXT_TOKEN_VERSION,
  type SessionTextTokenResult,
  type SessionTextTokenSource,
} from '../ports/session-text-tokens'
import type { Message } from '../types/session'
import type { SessionRowSqlBindValue, SessionRowSqlDatabase, SessionRowSqlStatement } from './session-row-sql'

const encoder = new TextEncoder()
const BUDGET = 384 * 1024
const BATCH_SIZE = 80

export const SESSION_TEXT_TOKEN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_text_tokens (
  session_id TEXT NOT NULL, message_id TEXT NOT NULL, tokenizer_type TEXT NOT NULL,
  payload_id TEXT NOT NULL, calculation_version TEXT NOT NULL,
  tokens REAL NOT NULL, calculated_at REAL NOT NULL, approximate INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id, tokenizer_type)
);
`

/** Run after the final live rows are installed, in the same revision-guarded transaction. */
export function textTokenCleanupStatement(sessionId: string, messageId?: string): SessionRowSqlStatement {
  return {
    kind: 'delete-stale-text-tokens',
    sql: `DELETE FROM session_text_tokens WHERE session_id = ?${messageId === undefined ? '' : ' AND message_id = ?'}
      AND NOT EXISTS (SELECT 1 FROM session_messages m WHERE m.session_id = session_text_tokens.session_id
        AND m.message_id = session_text_tokens.message_id AND m.payload_id = session_text_tokens.payload_id)`,
    params: messageId === undefined ? [sessionId] : [sessionId, messageId],
  }
}

export function createTextTokenSource(
  sessionId: string,
  message: Message,
  payloadId: string
): SessionTextTokenSource | undefined {
  // Only a cryptographically random UUID nonce is reusable across runtimes/imports.
  if (!/:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payloadId)) return undefined
  const text = getSessionMessageTokenizationText(message)
  return Object.freeze({
    sessionId,
    messageId: message.id,
    payloadId,
    calculationVersion: SESSION_TEXT_TOKEN_VERSION,
    textDigest: getTokenizationTextDigest(text),
    text,
  })
}

function validSource(source: SessionTextTokenSource): boolean {
  return (
    source.calculationVersion === SESSION_TEXT_TOKEN_VERSION &&
    typeof source.sessionId === 'string' &&
    typeof source.messageId === 'string' &&
    typeof source.textDigest === 'string' &&
    typeof source.text === 'string' &&
    /:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.payloadId)
  )
}

function validResult(result: SessionTextTokenResult): boolean {
  const { source, value } = result
  return (
    validSource(source) &&
    value.sourceDigest === source.textDigest &&
    (value.tokenizerType === 'default' || value.tokenizerType === 'deepseek') &&
    Number.isFinite(value.tokens) &&
    value.tokens >= 0 &&
    value.tokens <= Number.MAX_SAFE_INTEGER &&
    Number.isFinite(value.calculatedAt) &&
    value.calculatedAt >= 0 &&
    value.calculatedAt <= Number.MAX_SAFE_INTEGER &&
    (value.approximate === undefined || typeof value.approximate === 'boolean')
  )
}

/** The bound includes both SQL text and JSON-escaped bindings, before crossing a native bridge. */
function* batches<T>(
  items: readonly T[],
  values: (item: T) => SessionRowSqlBindValue[],
  limit = BATCH_SIZE
): Generator<T[]> {
  let batch: T[] = []
  let bytes = 16 * 1024
  for (const item of items) {
    const size = encoder.encode(JSON.stringify(values(item))).byteLength + 128
    if (size + 16 * 1024 > BUDGET) throw new Error('Text token source exceeds the native request budget')
    if (batch.length === limit || bytes + size > BUDGET) {
      yield batch
      batch = []
      bytes = 16 * 1024
    }
    batch.push(item)
    bytes += size
  }
  if (batch.length) yield batch
}

interface TokenRecord {
  request_index: number
  tokenizer_type: string
  tokens: number
  calculated_at: number
  approximate: number
}

/** Same-database numerical owner. Payload reads, staging and conversation CAS remain with the row store. */
export class SessionTextTokenSqlCache {
  constructor(private readonly database: SessionRowSqlDatabase) {}

  async read(sources: readonly SessionTextTokenSource[], checkPresence = true): Promise<SessionTextTokenResult[]> {
    const results: SessionTextTokenResult[] = []
    const present = new Set<string>()
    if (checkPresence) {
      for (const sessionId of new Set(sources.map((source) => source.sessionId))) {
        const found = await this.database.query<{ present: number }>(
          'SELECT 1 AS present FROM session_text_tokens WHERE session_id=? AND calculation_version=? LIMIT 1',
          [sessionId, SESSION_TEXT_TOKEN_VERSION]
        )
        if (found.length) present.add(sessionId)
      }
    }
    const values = (source: SessionTextTokenSource) => [source.sessionId, source.messageId, source.payloadId]
    for (const batch of batches(
      sources.filter((source) => validSource(source) && (!checkPresence || present.has(source.sessionId))),
      values,
      288
    )) {
      // Keep requested sources as the outer loop so readback probes the existing session/message keys.
      const sql = `WITH requested(request_index,session_id,message_id,payload_id) AS (VALUES ${batch.map((_, i) => `(${i},?,?,?)`).join(',')})
        SELECT r.request_index,c.tokenizer_type,
          CASE WHEN typeof(c.tokens) IN ('integer','real') AND c.tokens BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} THEN c.tokens END AS tokens,
          CASE WHEN typeof(c.calculated_at) IN ('integer','real') AND c.calculated_at BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} THEN c.calculated_at END AS calculated_at,
          CASE WHEN c.approximate IN (0,1) THEN c.approximate END AS approximate
        FROM requested r CROSS JOIN session_messages m CROSS JOIN session_text_tokens c
        WHERE c.calculation_version=? AND c.tokenizer_type IN ('default','deepseek')
          AND m.session_id=r.session_id AND m.message_id=r.message_id AND m.payload_id=r.payload_id
          AND c.session_id=r.session_id AND c.message_id=r.message_id AND c.payload_id=r.payload_id`
      const rows = await this.database.query<TokenRecord>(sql, [...batch.flatMap(values), SESSION_TEXT_TOKEN_VERSION])
      for (const row of rows) {
        const source = Number.isInteger(row.request_index) ? batch[row.request_index] : undefined
        if (
          !source ||
          (row.tokenizer_type !== 'default' && row.tokenizer_type !== 'deepseek') ||
          !Number.isFinite(row.tokens) ||
          row.tokens < 0 ||
          row.tokens > Number.MAX_SAFE_INTEGER ||
          !Number.isFinite(row.calculated_at) ||
          row.calculated_at < 0 ||
          row.calculated_at > Number.MAX_SAFE_INTEGER ||
          (row.approximate !== 0 && row.approximate !== 1)
        )
          continue
        results.push({
          source,
          value: {
            tokenizerType: row.tokenizer_type,
            sourceDigest: source.textDigest,
            tokens: row.tokens,
            calculatedAt: row.calculated_at,
            approximate: row.approximate === 1,
          },
        })
      }
    }
    return results
  }

  async accept(results: readonly SessionTextTokenResult[]): Promise<SessionTextTokenResult[]> {
    const accepted: SessionTextTokenResult[] = []
    const values = ({ source, value }: SessionTextTokenResult): SessionRowSqlBindValue[] => [
      source.sessionId,
      source.messageId,
      value.tokenizerType,
      source.payloadId,
      source.calculationVersion,
      value.tokens,
      value.calculatedAt,
      value.approximate === true ? 1 : 0,
    ]
    let statements: SessionRowSqlStatement[] = []
    let pending: SessionTextTokenSource[] = []
    let bytes = 1024
    const commit = async () => {
      if (!statements.length) return
      await this.database.executeBatch(statements)
      const unique = [
        ...new Map(
          pending.map((source) => [JSON.stringify([source.sessionId, source.messageId, source.payloadId]), source])
        ).values(),
      ]
      for (const result of await this.read(unique, false)) accepted.push(result)
      statements = []
      pending = []
      bytes = 1024
    }
    for (const batch of batches(results.filter(validResult), values, 64)) {
      const sql = `WITH input(session_id,message_id,tokenizer_type,payload_id,calculation_version,tokens,calculated_at,approximate) AS
        (VALUES ${batch.map(() => '(?,?,?,?,?,?,?,?)').join(',')})
        INSERT INTO session_text_tokens SELECT i.* FROM input i JOIN session_messages m
          ON m.session_id=i.session_id AND m.message_id=i.message_id AND m.payload_id=i.payload_id WHERE 1
        ON CONFLICT(session_id,message_id,tokenizer_type) DO UPDATE SET
          payload_id=excluded.payload_id,calculation_version=excluded.calculation_version,tokens=excluded.tokens,
          calculated_at=excluded.calculated_at,approximate=excluded.approximate
        WHERE session_text_tokens.payload_id<>excluded.payload_id OR session_text_tokens.calculation_version<>excluded.calculation_version OR
          typeof(session_text_tokens.tokens) NOT IN ('integer','real') OR session_text_tokens.tokens NOT BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} OR
          typeof(session_text_tokens.calculated_at) NOT IN ('integer','real') OR session_text_tokens.calculated_at NOT BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} OR
          session_text_tokens.approximate NOT IN (0,1) OR
          (excluded.calculated_at>=session_text_tokens.calculated_at AND
            (session_text_tokens.approximate=1 OR excluded.approximate=0) AND
            (session_text_tokens.tokens<>excluded.tokens OR session_text_tokens.calculated_at<>excluded.calculated_at OR session_text_tokens.approximate<>excluded.approximate))`
      const params = batch.flatMap(values)
      const size = encoder.encode(JSON.stringify({ statement: sql, values: params })).byteLength + 1
      if (bytes + size > BUDGET) await commit()
      statements.push({ sql, params })
      bytes += size
      pending.push(...batch.map((result) => result.source))
    }
    await commit()
    return accepted
  }
}
