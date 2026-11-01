export type ByteStreamReadResult =
  | { readonly done: true; readonly value: Uint8Array | undefined }
  | { readonly done: false; readonly value: Uint8Array }

export interface ByteStreamReader {
  read(): Promise<ByteStreamReadResult>
  cancel(reason?: unknown): Promise<void>
}

export interface ByteReadableStream {
  getReader(): ByteStreamReader
}

/** Minimal file surface shared by browser File and Expo File. */
export interface ByteSource {
  readonly size: number
  /**
   * Optional random-access reader for native file implementations whose Blob.slice()
   * cannot safely construct a Blob from typed-array data (for example React Native).
   */
  readBytes?(offset: number, length: number): Promise<Uint8Array>
  chunks?(): AsyncIterable<Uint8Array>
  slice?(start?: number, end?: number, contentType?: string): { arrayBuffer(): Promise<ArrayBuffer> }
  stream?(): ByteReadableStream
}

export async function readFileBytes(file: ByteSource, offset: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
    throw new Error('File read offset is invalid')
  }
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('File read length is invalid')

  const expectedLength = Math.min(length, file.size - offset)
  const bytes = file.readBytes
    ? await file.readBytes(offset, expectedLength)
    : file.slice
      ? new Uint8Array(await file.slice(offset, offset + expectedLength).arrayBuffer())
      : undefined
  if (!bytes) throw new Error('File does not support random-access reads')
  if (bytes.byteLength !== expectedLength) throw new Error('File ended unexpectedly')
  return bytes
}

/** A byte source whose native handle belongs to the caller. */
export interface ClosableByteSource extends ByteSource {
  close(): Promise<void>
}

/** Serial writes become visible only after close; abort discards unfinished output. */
export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
