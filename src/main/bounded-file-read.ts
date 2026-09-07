import { constants as bufferConstants } from 'node:buffer'
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'

const MIN_GROWTH_BYTES = 64 * 1024

export type BoundedFileReadResult =
  | { success: true; bytes: Buffer }
  | { success: false; reason: 'not-regular-file' }
  | { success: false; reason: 'too-large'; maxBytes: number; size?: number }

type TooLargeFileReadResult = Extract<BoundedFileReadResult, { reason: 'too-large' }>

interface BoundedReadableFile {
  read(buffer: Uint8Array<ArrayBuffer>, offset: number, length: number, position: null): Promise<{ bytesRead: number }>
}

export function formatTooLargeFileRead(result: TooLargeFileReadResult, subject: string): string {
  return result.size === undefined
    ? `${subject} exceeded the maximum size while reading (max ${result.maxBytes})`
    : `${subject} is too large (${result.size} bytes, max ${result.maxBytes})`
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= bufferConstants.MAX_LENGTH) {
    throw new RangeError(`Invalid file read limit: ${maxBytes}`)
  }
}

/**
 * Read through an already-open handle and stop after observing maxBytes + 1.
 * The initial size is only a fast rejection; the read limit remains authoritative
 * when a producer keeps appending to the file after stat().
 */
export async function readFileHandleBytesBounded(
  file: BoundedReadableFile,
  maxBytes: number,
  initialSize: number
): Promise<BoundedFileReadResult> {
  validateMaxBytes(maxBytes)
  if (initialSize > maxBytes) {
    return { success: false, reason: 'too-large', maxBytes, size: initialSize }
  }

  const maximumCapacity = maxBytes + 1
  let buffer = new Uint8Array(new ArrayBuffer(Math.min(maximumCapacity, Math.max(1, initialSize + 1))))
  let offset = 0

  while (true) {
    if (offset === buffer.length) {
      if (offset >= maximumCapacity) {
        return { success: false, reason: 'too-large', maxBytes }
      }
      const nextCapacity = Math.min(maximumCapacity, Math.max(buffer.length * 2, buffer.length + MIN_GROWTH_BYTES))
      const grown = new Uint8Array(new ArrayBuffer(nextCapacity))
      grown.set(buffer.subarray(0, offset))
      buffer = grown
    }

    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null)
    if (bytesRead === 0) {
      return { success: true, bytes: Buffer.from(buffer.buffer, buffer.byteOffset, offset) }
    }
    offset += bytesRead
    if (offset > maxBytes) {
      return { success: false, reason: 'too-large', maxBytes }
    }
  }
}

/** Open once, validate that handle, and keep the size bound active during the read. */
export async function readRegularFileBytesBounded(filePath: string, maxBytes?: number): Promise<BoundedFileReadResult> {
  // O_NONBLOCK keeps a replaced FIFO/device from hanging before the handle can
  // be validated. It has no effect on regular-file reads.
  const file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) {
      return { success: false, reason: 'not-regular-file' }
    }
    if (maxBytes === undefined) {
      return { success: true, bytes: await file.readFile() }
    }
    return await readFileHandleBytesBounded(file, maxBytes, stat.size)
  } finally {
    await file.close()
  }
}
