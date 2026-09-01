import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
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
  limits?: ZipReadLimits
  entryLimits?: (path: string) => Partial<Pick<ZipReadLimits, 'maxEntryUncompressedBytes' | 'maxCompressionRatio'>>
  signal?: AbortSignal
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
  const centralDirectorySize = view.getUint32(12, true)
  const centralDirectoryOffset = view.getUint32(16, true)
  if (centralDirectoryOffset + centralDirectorySize > file.size - (tail.length - recordOffset)) {
    throw new Error('ZIP archive central directory is invalid')
  }
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

export async function readZipFileEntries(
  file: BackupFile,
  onEntry: (entry: ReadZipEntry) => Promise<void> | void,
  options: ZipReadOptions = {}
): Promise<void> {
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
