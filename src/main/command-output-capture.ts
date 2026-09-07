import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const INLINE_STREAM_PREVIEW_BYTES = 6_000
export const MAX_COMMAND_OUTPUT_CAPTURE_BYTES = 10 * 1024 * 1024
export const COMMAND_OUTPUT_CAPTURE_FAILED_MESSAGE = '[Full command output could not be saved]'
const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
let lastCleanupAt = 0
let commandOutputCaptureRoot = path.join(tmpdir(), 'chatbox-command-output')

export function configureCommandOutputCaptureRoot(userDataPath: string): void {
  commandOutputCaptureRoot = path.join(userDataPath, 'command-output')
  lastCleanupAt = 0
}

export function getCommandOutputCaptureRoot(): string {
  return commandOutputCaptureRoot
}

export interface CommandOutputCapture {
  /** False means the producer must pause until onDrain fires. */
  append(source: 'stdout' | 'stderr', chunk: Buffer): boolean
  onDrain(callback: () => void): void
  isLimitExceeded(): boolean
  isFailed(): boolean
  finish(): Promise<string | undefined>
}

export function createCommandOutputCapturePath(toolCallId?: string): string {
  const now = Date.now()
  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now
    cleanupStaleCommandOutputCaptures({ now })
  }
  const captureRoot = getCommandOutputCaptureRoot()
  mkdirSync(captureRoot, { recursive: true, mode: 0o700 })
  const safeToolCallId = toolCallId?.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'command'
  return path.join(captureRoot, `${safeToolCallId}-${randomUUID()}.txt`)
}

/** Remove retained output captures after their short-lived session references have expired. */
export function cleanupStaleCommandOutputCaptures(options?: { now?: number; root?: string }): void {
  const root = options?.root ?? getCommandOutputCaptureRoot()
  if (!existsSync(root)) return
  const now = options?.now ?? Date.now()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue
    const filePath = path.join(root, entry.name)
    try {
      if (now - statSync(filePath).mtimeMs > CAPTURE_MAX_AGE_MS) rmSync(filePath, { force: true })
    } catch {
      // A concurrent cleanup or OS temp reaper may have already removed this entry.
    }
  }
}

/** Stream complete command output to disk while the caller retains only a short in-memory preview. */
export function createCommandOutputCapture(outputFilePath: string): CommandOutputCapture {
  mkdirSync(path.dirname(outputFilePath), { recursive: true, mode: 0o700 })
  const stream = createWriteStream(outputFilePath, { flags: 'wx', mode: 0o600 })
  const sourceBytes = { stdout: 0, stderr: 0 }
  let lastSource: 'stdout' | 'stderr' | undefined
  let opened = false
  let failed = false
  let finished = false
  let capturedBytes = 0
  let limitExceeded = false
  const drainCallbacks = new Set<() => void>()
  const releaseBackpressure = () => {
    for (const callback of drainCallbacks) callback()
    drainCallbacks.clear()
  }
  const completion = new Promise<void>((resolve) => {
    stream.once('open', () => {
      opened = true
    })
    stream.once('error', () => {
      failed = true
      releaseBackpressure()
      resolve()
    })
    stream.once('close', resolve)
  })
  stream.on('drain', releaseBackpressure)

  return {
    append(source, chunk) {
      if (finished || failed) return true
      sourceBytes[source] += chunk.byteLength
      const header = lastSource !== source ? `${lastSource ? '\n\n' : ''}${source.toUpperCase()}\n======\n` : ''
      const headerBytes = Buffer.byteLength(header)
      const remainingCaptureBytes = MAX_COMMAND_OUTPUT_CAPTURE_BYTES - capturedBytes
      if (remainingCaptureBytes <= headerBytes) {
        limitExceeded = true
        return true
      }
      const remainingChunkBytes = remainingCaptureBytes - headerBytes
      const capturedChunk = chunk.byteLength > remainingChunkBytes ? chunk.subarray(0, remainingChunkBytes) : chunk
      capturedBytes += headerBytes + capturedChunk.byteLength
      if (capturedChunk.byteLength < chunk.byteLength) limitExceeded = true
      lastSource = source
      if (!header) return stream.write(capturedChunk)
      stream.cork()
      const headerAccepted = stream.write(header)
      const chunkAccepted = stream.write(capturedChunk)
      stream.uncork()
      return headerAccepted && chunkAccepted
    },
    onDrain(callback) {
      if (failed || finished) queueMicrotask(callback)
      else drainCallbacks.add(callback)
    },
    isLimitExceeded() {
      return limitExceeded
    },
    isFailed() {
      return failed
    },
    async finish() {
      if (!finished) {
        finished = true
        stream.end()
      }
      await completion
      const previewWasTruncated = Object.values(sourceBytes).some((bytes) => bytes > INLINE_STREAM_PREVIEW_BYTES)
      if (failed || !previewWasTruncated) {
        if (!failed || opened) rmSync(outputFilePath, { force: true })
        return undefined
      }
      return outputFilePath
    },
  }
}
