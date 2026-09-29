import type { SessionRowSqlDatabase } from '../persistence/session-row-sql'
import type { BackupFile } from './types'

const PREFIX = '__CHATBOX_CHUNKED_VALUE_V1__:'
/** hex() doubles the window on the wire, keeping each response within the 384 KiB soft bridge budget. */
const READ_AHEAD_BYTES = 128 * 1024
/** Response budget for one chunk query, and the JSON envelope estimated for each returned row. */
const CHUNK_READ_RESPONSE_BUDGET = 320 * 1024
const CHUNK_ROW_RESPONSE_OVERHEAD = 96
const HEX_VALUES = new Int8Array(128).fill(-1)
for (let index = 0; index < 16; index++) {
  HEX_VALUES['0123456789abcdef'.charCodeAt(index)] = index
  HEX_VALUES['0123456789ABCDEF'.charCodeAt(index)] = index
}

/** Decodes SQLite hex() output into target at offset; false when any character is not hex. */
function decodeHex(hex: string, target: Uint8Array, offset: number): boolean {
  for (let index = 0; index < hex.length; index += 2) {
    const high = HEX_VALUES[hex.charCodeAt(index)] ?? -1
    const low = HEX_VALUES[hex.charCodeAt(index + 1)] ?? -1
    if (high < 0 || low < 0) return false
    target[offset + index / 2] = (high << 4) | low
  }
  return true
}
/** Bounded byte reads of the released key/value layout, including chunked values. */
export async function openSqlBackupValue(
  database: Pick<SessionRowSqlDatabase, 'query'>,
  key: string
): Promise<BackupFile | null> {
  const [head] = await database.query<{ prefix: string; size: number }>(
    'SELECT substr(value, 1, 128) AS prefix, length(CAST(value AS BLOB)) AS size FROM key_value WHERE key = ?',
    [key]
  )
  if (!head) return null
  let size = head.size
  let generation: string | undefined
  let expectedCharacters: number | undefined
  const blocks: Array<{ index: number; start: number; end: number }> = []
  if (head.prefix.startsWith(PREFIX)) {
    const match = head.prefix.slice(PREFIX.length).match(/^([^:]+):(\d+):(\d+)$/)
    if (!match) throw new Error('Invalid legacy value manifest')
    generation = match[1]
    const count = Number(match[2])
    expectedCharacters = Number(match[3])
    if (!Number.isSafeInteger(expectedCharacters) || expectedCharacters < 1 || expectedCharacters > 4 * 1024 ** 3)
      throw new Error('Invalid legacy character count')
    const [actualCount] = await database.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM key_value_chunks WHERE key = ? AND generation = ?',
      [key, generation]
    )
    if (actualCount?.count !== count) throw new Error('Legacy value chunk count mismatch')
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
      throw new Error('Legacy value chunk count exceeds budget')
    size = 0
    for (let offset = 0; offset < count; offset += 128) {
      const page = await database.query<{ chunk_index: number; size: number }>(
        'SELECT chunk_index, length(CAST(value AS BLOB)) AS size FROM key_value_chunks WHERE key = ? AND generation = ? ORDER BY chunk_index LIMIT 128 OFFSET ?',
        [key, generation, offset]
      )
      if (page.length !== Math.min(128, count - offset)) throw new Error('Legacy value chunks are missing')
      for (const row of page) {
        if (row.chunk_index !== blocks.length || !Number.isSafeInteger(row.size) || row.size < 1)
          throw new Error('Invalid legacy value chunk')
        blocks.push({ index: row.chunk_index, start: size, end: size + row.size })
        size += row.size
      }
    }
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 ** 3)
    throw new Error('Legacy value exceeds backup budget')
  let scan:
    | {
        offset: number
        characters: number
        decoder: { decode(input?: Uint8Array, options?: { stream?: boolean }): string }
      }
    | undefined
  let window: { start: number; bytes: Uint8Array } | undefined
  /** Sequential readers fetch one bounded window per native query instead of one per requested range. */
  const readRange = async (offset: number, length: number) => {
    const result = new Uint8Array(length)
    let low = 0
    let high = blocks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (blocks[middle].end <= offset) low = middle + 1
      else high = middle
    }
    const selected = generation ? blocks.slice(low, low + 1) : [{ index: 0, start: 0, end: size }]
    if (generation)
      for (let index = low + 1; index < blocks.length && blocks[index].start < offset + length; index++)
        selected.push(blocks[index])
    let used = 0
    const ranges = selected.map((block) => {
      const start = Math.max(offset, block.start)
      return { index: block.index, from: start - block.start + 1, count: Math.min(offset + length, block.end) - start }
    })
    for (let first = 0; first < ranges.length; ) {
      // Each response carries hex text plus a row envelope; many small chunks split across queries.
      let last = first
      let responseBytes = ranges[first].count * 2 + CHUNK_ROW_RESPONSE_OVERHEAD
      while (
        last + 1 < ranges.length &&
        responseBytes + ranges[last + 1].count * 2 + CHUNK_ROW_RESPONSE_OVERHEAD <= CHUNK_READ_RESPONSE_BUDGET
      ) {
        last++
        responseBytes += ranges[last].count * 2 + CHUNK_ROW_RESPONSE_OVERHEAD
      }
      const group = ranges.slice(first, last + 1)
      const rows = !generation
        ? await database.query<{ i: number; value: string }>(
            'SELECT 0 AS i, hex(substr(CAST(value AS BLOB), ?, ?)) AS value FROM key_value WHERE key = ?',
            [group[0].from, group[0].count, key]
          )
        : group.length === 1
          ? await database.query<{ i: number; value: string }>(
              'SELECT chunk_index AS i, hex(substr(CAST(value AS BLOB), ?, ?)) AS value FROM key_value_chunks WHERE key = ? AND generation = ? AND chunk_index = ?',
              [group[0].from, group[0].count, key, generation, group[0].index]
            )
          : // Interior chunks are read whole; only the first and last chunk of a group are partial.
            await database.query<{ i: number; value: string }>(
              'SELECT chunk_index AS i, hex(substr(CAST(value AS BLOB), CASE WHEN chunk_index = ? THEN ? ELSE 1 END, CASE WHEN chunk_index = ? THEN ? WHEN chunk_index = ? THEN ? ELSE length(CAST(value AS BLOB)) END)) AS value FROM key_value_chunks WHERE key = ? AND generation = ? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index',
              [
                group[0].index,
                group[0].from,
                group[0].index,
                group[0].count,
                group[group.length - 1].index,
                group[group.length - 1].count,
                key,
                generation,
                group[0].index,
                group[group.length - 1].index,
              ]
            )
      if (rows.length !== group.length) throw new Error('Legacy backup source changed during read')
      for (const [position, range] of group.entries()) {
        const row = rows[position]
        if (
          (generation && row.i !== range.index) ||
          row.value.length !== range.count * 2 ||
          !decodeHex(row.value, result, used)
        )
          throw new Error('Legacy backup source changed during read')
        used += range.count
      }
      first = last + 1
    }
    if (used !== length) throw new Error('Legacy backup range is incomplete')
    return result
  }
  return {
    size,
    text: async () => {
      throw new Error('Whole legacy backup reads are unavailable')
    },
    async readBytes(offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > size ||
        length > 64 * 1024
      )
        throw new Error('Legacy backup range exceeds budget')
      if (!window || offset < window.start || offset + length > window.start + window.bytes.length)
        window = {
          start: offset,
          bytes: await readRange(offset, Math.max(length, Math.min(READ_AHEAD_BYTES, size - offset))),
        }
      const result = window.bytes.slice(offset - window.start, offset - window.start + length)
      if (expectedCharacters !== undefined) {
        if (offset === 0)
          scan = { offset: 0, characters: 0, decoder: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) }
        if (scan?.offset === offset) {
          scan.offset += result.length
          scan.characters += scan.decoder.decode(result, { stream: true }).length
          if (scan.offset === size) {
            scan.characters += scan.decoder.decode().length
            if (scan.characters !== expectedCharacters) throw new Error('Legacy value character count mismatch')
            scan = undefined
          }
        } else scan = undefined
      }
      return result
    },
  }
}
