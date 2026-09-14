import type { SessionRowSqlDatabase } from '../persistence/session-row-sql'
import type { BackupFile } from './types'

const PREFIX = '__CHATBOX_CHUNKED_VALUE_V1__:'
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
      for (const block of selected) {
        const start = Math.max(offset, block.start)
        const count = Math.min(offset + length, block.end) - start
        const [row] = await database.query<{ value: string }>(
          generation
            ? 'SELECT hex(substr(CAST(value AS BLOB), ?, ?)) AS value FROM key_value_chunks WHERE key = ? AND generation = ? AND chunk_index = ?'
            : 'SELECT hex(substr(CAST(value AS BLOB), ?, ?)) AS value FROM key_value WHERE key = ?',
          generation ? [start - block.start + 1, count, key, generation, block.index] : [start + 1, count, key]
        )
        if (!row || row.value.length !== count * 2 || !/^[0-9A-F]*$/i.test(row.value))
          throw new Error('Legacy backup source changed during read')
        for (let i = 0; i < count; i++) result[used++] = Number.parseInt(row.value.slice(i * 2, i * 2 + 2), 16)
      }
      if (used !== length) throw new Error('Legacy backup range is incomplete')
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
