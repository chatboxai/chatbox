import type { SessionRowSqlBindValue, SessionRowSqlDatabase } from './session-row-sql'

interface RowMetadataJson {
  message_id: string
  row_metadata_json: string | null
}

/** Upper bound for a string serialized by the native JSON bridge. */
export function sqlMetadataStringBytes(column: string): string {
  return `(CASE WHEN instr(${column},char(0))=0 AND ${column} NOT GLOB '*[^ -~]*'
    AND instr(${column},'<')=0 AND instr(${column},'>')=0 AND instr(${column},'&')=0
    AND instr(${column},'/')=0 AND instr(${column},char(39))=0 AND instr(${column},char(96))=0
    THEN COALESCE(length(CAST(${column} AS BLOB)),0)
      + COALESCE(length(${column})-length(replace(${column},char(34),'')),0)
      + COALESCE(length(${column})-length(replace(${column},char(92),'')),0)
    ELSE 6*COALESCE(length(CAST(${column} AS BLOB)),0) END)`
}

function invalidScalar(column: string): string {
  if (column === 'created_at' || column === 'updated_at')
    return `(typeof(${column}) NOT IN ('integer','real') OR abs(${column})>1.7976931348623157e308)`
  if (column === 'eligible') return `(eligible IS NOT NULL AND (typeof(eligible)<>'integer' OR eligible NOT IN (0,1)))`
  if (['seq', 'payload_utf8_length', 'created_at', 'updated_at', 'selected_depth'].includes(column)) {
    const minimum = ['seq', 'payload_utf8_length', 'selected_depth'].includes(column) ? 0 : -9007199254740991
    const invalid = `(typeof(${column})<>'integer' OR ${column}<${minimum} OR ${column}>9007199254740991)`
    return column === 'selected_depth' ? `(${column} IS NOT NULL AND ${invalid})` : invalid
  }
  return `(typeof(${column}) NOT IN ('text','null'))`
}

/** Metadata can contain attachment identities, so even a single row is read in bridge-sized slices. */
export async function queryRowMetadata<T extends RowMetadataJson>(
  database: SessionRowSqlDatabase,
  sql: string,
  params: SessionRowSqlBindValue[],
  columns: readonly string[],
  bounded: boolean
): Promise<T[]> {
  if (!bounded) return database.query<T>(sql, params)
  const names = columns.filter((column) => column !== 'row_metadata_json')
  const fields = names.join(',')
  const invalid = names.map(invalidScalar).join(' OR ')
  const estimate = [
    '512',
    ...names.map(sqlMetadataStringBytes),
    sqlMetadataStringBytes('substr(row_metadata_json,1,4096)'),
  ].join('+')
  const rows: Array<T & { metadata_length: number | null }> = []
  for (;;) {
    const page = await database.query<
      T & { metadata_length: number | null; source_count: number; metadata_oversized: number }
    >(
      `SELECT ${names.map((column) => `CASE WHEN row_bytes<=196608 THEN ${column} END AS ${column}`).join(',')},metadata_length,
        CASE WHEN row_bytes<=196608 THEN row_metadata_json END AS row_metadata_json,source_count,(row_bytes>196608) AS metadata_oversized FROM (
        SELECT ${fields},length(row_metadata_json) AS metadata_length,substr(row_metadata_json,1,4096) AS row_metadata_json,
          (CASE WHEN ${invalid} THEN 196609 ELSE ${estimate} END) AS row_bytes,SUM(CASE WHEN ${invalid} THEN 196609 ELSE ${estimate} END) OVER(ROWS UNBOUNDED PRECEDING) AS response_bytes,row_number() OVER() AS response_index,COUNT(*) OVER() AS source_count
        FROM (SELECT * FROM (${sql}) LIMIT -1 OFFSET ?)
      ) WHERE response_bytes<=196608 OR response_index=1`,
      [...params, rows.length]
    )
    if (page.some((row) => row.metadata_oversized))
      throw new Error('Message structural metadata exceeds the native response budget')
    rows.push(...page)
    if (!page.length || page.length >= Number(page[0].source_count)) break
  }
  for (const row of rows) {
    if (row.metadata_length === null) continue
    let value = row.row_metadata_json ?? ''
    for (let offset = 4096; offset < Number(row.metadata_length); offset += 4096) {
      const [slice] = await database.query<{ value: string }>(
        `SELECT substr(row_metadata_json,?,4096) AS value FROM (${sql}) WHERE message_id=?`,
        [offset + 1, ...params, row.message_id]
      )
      if (!slice?.value) throw new Error('Message metadata changed during a read')
      value += slice.value
    }
    row.row_metadata_json = value
  }
  return rows
}
