import { Inflate, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { throwIfAborted } from './abort'
import { type BackupFile, readBackupFileBytes } from './types'

export const DEFAULT_ZIP_LIMITS = {
  maxEntries: 100_004,
  maxEntryUncompressedBytes: 512 * 1024 * 1024,
  maxTotalUncompressedBytes: 4 * 1024 * 1024 * 1024,
  maxCompressionRatio: 2_000,
} as const

const EMPTY_BYTES = new Uint8Array(0)
const ZIP_INPUT_CHUNK_SIZE = 1024 * 1024
const ZIP_OUTPUT_HIGH_WATER_MARK = 4 * 1024 * 1024

export interface ZipArchiveEntry {
  path: string
  data: Uint8Array | AsyncIterable<Uint8Array>
  compress?: boolean
}

export interface ZipReadLimits {
  maxEntries?: number
  maxEntryUncompressedBytes?: number
  maxTotalUncompressedBytes?: number
  maxCompressionRatio?: number
}

export interface ZipReadOptions {
  streamEntry?: (path: string) => boolean
  onStreamEntry?: (entry: Omit<ReadZipEntry, 'data'> & { data: AsyncIterable<Uint8Array> }) => Promise<void>
  limits?: ZipReadLimits
  entryLimits?: (path: string) => Partial<Pick<ZipReadLimits, 'maxEntryUncompressedBytes' | 'maxCompressionRatio'>>
  signal?: AbortSignal
  /** Bytes retained for the current entry; callbacks are strictly sequential. */
  onBufferedBytes?: (bytes: number) => void
  bounded?: boolean
  filter?: (path: string) => boolean
}

export function assertSafeArchivePath(path: string): void {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`Unsafe ZIP entry path: ${path}`)
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe ZIP entry path: ${path}`)
  }
}

function* splitBytes(bytes: Uint8Array): Generator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += ZIP_INPUT_CHUNK_SIZE) {
    yield bytes.subarray(offset, Math.min(offset + ZIP_INPUT_CHUNK_SIZE, bytes.length))
  }
}

function toChunks(data: ZipArchiveEntry['data']): Iterable<Uint8Array> | AsyncIterable<Uint8Array> {
  return data instanceof Uint8Array ? splitBytes(data) : data
}

export async function* createZipStream(
  entries: Iterable<ZipArchiveEntry> | AsyncIterable<ZipArchiveEntry>,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = []
  let queuedBytes = 0
  let outputComplete = false
  let producerError: unknown
  let wakeConsumer: (() => void) | undefined
  let wakeProducer: (() => void) | undefined
  const seenPaths = new Set<string>()

  const notifyConsumer = () => {
    wakeConsumer?.()
    wakeConsumer = undefined
  }
  const notifyProducer = (force = false) => {
    if (force || queuedBytes <= ZIP_OUTPUT_HIGH_WATER_MARK / 2) {
      wakeProducer?.()
      wakeProducer = undefined
    }
  }
  const waitForDrain = async () => {
    if (queuedBytes <= ZIP_OUTPUT_HIGH_WATER_MARK) return
    await new Promise<void>((resolve) => {
      wakeProducer = resolve
    })
  }

  const zip = new Zip((error, data, final) => {
    if (error) {
      producerError = error
      outputComplete = true
      notifyConsumer()
      return
    }
    if (data.length > 0) {
      queue.push(data)
      queuedBytes += data.length
    }
    if (final) outputComplete = true
    notifyConsumer()
  })

  const onAbort = () => zip.terminate()
  signal?.addEventListener('abort', onAbort, { once: true })

  void (async () => {
    try {
      for await (const entry of entries) {
        throwIfAborted(signal)
        assertSafeArchivePath(entry.path)
        if (seenPaths.has(entry.path)) throw new Error(`Duplicate ZIP entry: ${entry.path}`)
        seenPaths.add(entry.path)
        const file =
          entry.compress === false ? new ZipPassThrough(entry.path) : new ZipDeflate(entry.path, { level: 6 })
        zip.add(file)
        let pushed = false
        for await (const chunk of toChunks(entry.data)) {
          throwIfAborted(signal)
          if (chunk.length === 0) continue
          if (pushed) {
            file.push(chunk)
          } else {
            file.push(chunk)
            pushed = true
          }
          await waitForDrain()
        }
        file.push(EMPTY_BYTES, true)
        await waitForDrain()
      }
      throwIfAborted(signal)
      zip.end()
    } catch (error) {
      producerError = error
      outputComplete = true
      zip.terminate()
      notifyConsumer()
    }
  })()

  try {
    while (true) {
      throwIfAborted(signal)
      const chunk = queue.shift()
      if (chunk) {
        queuedBytes -= chunk.length
        notifyProducer()
        yield chunk
        continue
      }
      if (producerError) throw producerError
      if (outputComplete) return
      await new Promise<void>((resolve) => {
        wakeConsumer = resolve
      })
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    zip.terminate()
    notifyProducer(true)
  }
}

export interface ReadZipEntry {
  path: string
  data: Uint8Array
  compressedSize?: number
  uncompressedSize: number
}

async function validateZipEndOfCentralDirectory(file: BackupFile) {
  const minimumRecordSize = 22
  const maximumCommentSize = 65_535
  if (file.size < minimumRecordSize) throw new Error('ZIP archive is truncated')
  const tailSize = Math.min(file.size, minimumRecordSize + maximumCommentSize)
  const tail = await readBackupFileBytes(file, file.size - tailSize, tailSize)
  let recordOffset = -1
  for (let index = tail.length - minimumRecordSize; index >= 0; index--) {
    if (tail[index] === 0x50 && tail[index + 1] === 0x4b && tail[index + 2] === 0x05 && tail[index + 3] === 0x06) {
      const candidateView = new DataView(tail.buffer, tail.byteOffset + index, tail.length - index)
      const commentLength = candidateView.getUint16(20, true)
      if (index + minimumRecordSize + commentLength === tail.length) {
        recordOffset = index
        break
      }
    }
  }
  if (recordOffset < 0) throw new Error('ZIP archive is missing its central directory')
  const view = new DataView(tail.buffer, tail.byteOffset + recordOffset, tail.length - recordOffset)
  if (
    view.getUint16(4, true) !== 0 ||
    view.getUint16(6, true) !== 0 ||
    view.getUint16(8, true) !== view.getUint16(10, true)
  )
    throw new Error('Multi-disk ZIP is unsupported')
  const entryCount = view.getUint16(10, true)
  const centralDirectorySize = view.getUint32(12, true)
  const centralDirectoryOffset = view.getUint32(16, true)
  if (centralDirectoryOffset + centralDirectorySize > file.size - (tail.length - recordOffset)) {
    throw new Error('ZIP archive central directory is invalid')
  }
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff || centralDirectorySize === 0xffffffff)
    throw new Error('ZIP64 is unsupported')
  return { offset: centralDirectoryOffset, size: centralDirectorySize, entryCount }
}

function combineChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const output = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

async function* readBackupFileChunks(file: BackupFile): AsyncGenerator<Uint8Array> {
  if (file.chunks) {
    yield* file.chunks()
    return
  }

  const stream = file.stream?.()
  if (!stream) throw new Error('Backup file does not support sequential reads')
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function readBoundedZipFileEntries(
  file: BackupFile,
  onEntry: (entry: ReadZipEntry) => Promise<void> | void,
  options: ZipReadOptions = {}
): Promise<void> {
  const directory = await validateZipEndOfCentralDirectory(file)
  const limits = { ...DEFAULT_ZIP_LIMITS, ...options.limits }
  if (directory.entryCount > limits.maxEntries) throw new Error('ZIP contains too many entries')
  const seenPaths = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let position = directory.offset
  let total = 0
  let previousEnd = 0
  for (let index = 0; index < directory.entryCount; index++) {
    throwIfAborted(options.signal)
    const header = await readBackupFileBytes(file, position, 46)
    if (header.length !== 46) throw new Error('ZIP central directory is truncated')
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    if (view.getUint32(0, true) !== 0x02014b50) throw new Error('ZIP central directory is invalid')
    const flags = view.getUint16(8, true)
    const method = view.getUint16(10, true)
    const compressedSize = view.getUint32(20, true)
    const uncompressedSize = view.getUint32(24, true)
    const nameLength = view.getUint16(28, true)
    const extraLength = view.getUint16(30, true)
    const commentLength = view.getUint16(32, true)
    const offset = view.getUint32(42, true)
    if (
      flags & 1 ||
      (method !== 0 && method !== 8) ||
      view.getUint16(34, true) !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    )
      throw new Error('Unsupported ZIP encoding')
    if (nameLength > 4096) throw new Error('ZIP path exceeds budget')
    const path = decoder.decode(await readBackupFileBytes(file, position + 46, nameLength))
    assertSafeArchivePath(path)
    if (seenPaths.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`)
    seenPaths.add(path)
    position += 46 + nameLength + extraLength + commentLength
    if (position > directory.offset + directory.size) throw new Error('ZIP central directory is invalid')
    const entryLimits = { ...limits, ...options.entryLimits?.(path) }
    if (uncompressedSize > entryLimits.maxEntryUncompressedBytes) throw new Error(`ZIP entry is too large: ${path}`)
    if (
      uncompressedSize > 1024 * 1024 &&
      uncompressedSize > Math.max(1, compressedSize) * entryLimits.maxCompressionRatio
    )
      throw new Error(`ZIP entry compression ratio is unsafe: ${path}`)
    total += uncompressedSize
    if (total > limits.maxTotalUncompressedBytes) throw new Error('ZIP uncompressed size exceeds the safety limit')
    const local = await readBackupFileBytes(file, offset, 30)
    if (local.length !== 30) throw new Error('ZIP local header is truncated')
    const lv = new DataView(local.buffer, local.byteOffset, local.byteLength)
    if (lv.getUint32(0, true) !== 0x04034b50 || lv.getUint16(6, true) !== flags || lv.getUint16(8, true) !== method)
      throw new Error('ZIP local header does not match central directory')
    const localNameLength = lv.getUint16(26, true)
    if (
      localNameLength !== nameLength ||
      decoder.decode(await readBackupFileBytes(file, offset + 30, localNameLength)) !== path
    )
      throw new Error('ZIP entry name mismatch')
    const dataStart = offset + 30 + localNameLength + lv.getUint16(28, true)
    const dataEnd = dataStart + compressedSize
    if (offset < previousEnd || dataEnd > directory.offset) throw new Error('ZIP entries overlap or are out of order')
    previousEnd = dataEnd
    if (options.filter && !options.filter(path)) continue
    const streaming = options.streamEntry?.(path) === true
    let consumed = false
    const data = async function* (): AsyncGenerator<Uint8Array> {
      const chunks: Uint8Array[] = []
      let entryBytes = 0
      let inflateError: Error | undefined
      const receive = (chunk: Uint8Array) => {
        entryBytes += chunk.length
        if (entryBytes > uncompressedSize || entryBytes > entryLimits.maxEntryUncompressedBytes) {
          inflateError = new Error(`ZIP entry is too large or has an invalid size: ${path}`)
          return
        }
        if (chunk.length) chunks.push(chunk)
      }
      const inflate = method === 8 ? new Inflate(receive) : undefined
      // A DEFLATE push can expand about 1032-fold. Bound each push before yielding.
      const inputSize = inflate ? 1024 : 64 * 1024
      for (let cursor = dataStart; cursor < dataEnd; cursor += inputSize) {
        throwIfAborted(options.signal)
        const input = await readBackupFileBytes(file, cursor, Math.min(inputSize, dataEnd - cursor))
        if (inflate) inflate.push(input, cursor + input.length === dataEnd)
        else receive(input)
        if (inflateError) throw inflateError
        options.onBufferedBytes?.(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
        for (const chunk of chunks) {
          for (let i = 0; i < chunk.length; i += 64 * 1024) yield chunk.subarray(i, i + 64 * 1024)
        }
        chunks.length = 0
      }
      if (inflate && compressedSize === 0) inflate.push(EMPTY_BYTES, true)
      if (inflateError) throw inflateError
      if (entryBytes !== uncompressedSize) throw new Error(`ZIP entry size mismatch: ${path}`)
      consumed = true
    }
    if (streaming) {
      if (!options.onStreamEntry) throw new Error('ZIP streaming consumer is missing')
      await options.onStreamEntry({ path, data: data(), compressedSize, uncompressedSize })
      if (!consumed) throw new Error('ZIP streaming entry was not fully consumed')
    } else {
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of data()) {
        chunks.push(chunk)
        size += chunk.length
        options.onBufferedBytes?.(size)
      }
      await onEntry({ path, data: combineChunks(chunks, size), compressedSize, uncompressedSize })
    }
    options.onBufferedBytes?.(0)
  }
  if (position !== directory.offset + directory.size) throw new Error('ZIP central directory entry count mismatch')
  if (total > 1024 * 1024 && total > Math.max(1, file.size) * limits.maxCompressionRatio)
    throw new Error('ZIP archive compression ratio is unsafe')
}

export async function readZipFileEntries(
  file: BackupFile,
  onEntry: (entry: ReadZipEntry) => Promise<void> | void,
  options: ZipReadOptions = {}
): Promise<void> {
  if (options.bounded || options.streamEntry) return readBoundedZipFileEntries(file, onEntry, options)
  await validateZipEndOfCentralDirectory(file)
  const limits = { ...DEFAULT_ZIP_LIMITS, ...options.limits }
  const seenPaths = new Set<string>()
  const pendingHandlers: Promise<void>[] = []
  let entryCount = 0
  let totalUncompressedBytes = 0
  let fatalError: unknown

  const unzip = new Unzip((entry) => {
    try {
      throwIfAborted(options.signal)
      assertSafeArchivePath(entry.name)
      if (seenPaths.has(entry.name)) throw new Error(`Duplicate ZIP entry: ${entry.name}`)
      seenPaths.add(entry.name)
      entryCount++
      if (entryCount > limits.maxEntries) throw new Error('ZIP contains too many entries')
      const entryLimits = { ...limits, ...options.entryLimits?.(entry.name) }
      if (entry.originalSize !== undefined && entry.originalSize > entryLimits.maxEntryUncompressedBytes) {
        throw new Error(`ZIP entry is too large: ${entry.name}`)
      }
      if (
        entry.size !== undefined &&
        entry.originalSize !== undefined &&
        entry.originalSize > 1024 * 1024 &&
        entry.originalSize > Math.max(1, entry.size) * entryLimits.maxCompressionRatio
      ) {
        throw new Error(`ZIP entry compression ratio is unsafe: ${entry.name}`)
      }

      const chunks: Uint8Array[] = []
      let entryBytes = 0
      entry.ondata = (error, data, final) => {
        if (fatalError) return
        if (error) {
          fatalError = error
          return
        }
        entryBytes += data.length
        totalUncompressedBytes += data.length
        if (entryBytes > entryLimits.maxEntryUncompressedBytes) {
          fatalError = new Error(`ZIP entry is too large: ${entry.name}`)
          entry.terminate()
          return
        }
        if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
          fatalError = new Error('ZIP uncompressed size exceeds the safety limit')
          entry.terminate()
          return
        }
        if (data.length > 0) chunks.push(data)
        if (final) {
          const handler = Promise.resolve(
            onEntry({
              path: entry.name,
              data: combineChunks(chunks, entryBytes),
              compressedSize: entry.size,
              uncompressedSize: entryBytes,
            })
          )
          pendingHandlers.push(handler)
        }
      }
      entry.start()
    } catch (error) {
      fatalError = error
      entry.terminate()
    }
  })
  unzip.register(UnzipInflate)

  for await (const value of readBackupFileChunks(file)) {
    throwIfAborted(options.signal)
    unzip.push(value)
    if (fatalError) throw fatalError
    if (pendingHandlers.length > 0) await Promise.all(pendingHandlers.splice(0))
  }
  unzip.push(EMPTY_BYTES, true)
  if (fatalError) throw fatalError
  if (pendingHandlers.length > 0) await Promise.all(pendingHandlers.splice(0))
  if (
    totalUncompressedBytes > 1024 * 1024 &&
    totalUncompressedBytes > Math.max(1, file.size) * limits.maxCompressionRatio
  ) {
    throw new Error('ZIP archive compression ratio is unsafe')
  }
}
