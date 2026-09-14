import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import type { BackupFile } from './types'
import { readZipFileEntries } from './zip'

it.each(['random', 'repeated'] as const)(
  'batches %s ZIP file reads while keeping decompression bounded',
  async (kind) => {
    const data =
      kind === 'random'
        ? Uint8Array.from(
            createHash('shake256', { outputLength: 2 * 1024 * 1024 })
              .update('backup-range-read-fixture')
              .digest()
          )
        : new Uint8Array(8 * 1024 * 1024).fill(97)
    const archive = zipSync({ 'payload.bin': data }, { level: 6 })
    const readBytes = vi.fn(async (offset: number, length: number) => archive.slice(offset, offset + length))
    const file: BackupFile = {
      size: archive.length,
      readBytes,
      text: async () => {
        throw new Error('ZIP should use range reads')
      },
    }
    const restored = createHash('sha256')
    let outputBytes = 0
    let peakBuffered = 0
    await readZipFileEntries(
      file,
      () => {
        throw new Error('Expected streamed entry')
      },
      {
        bounded: true,
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          for await (const chunk of entry.data) {
            expect(chunk.length).toBeLessThanOrEqual(64 * 1024)
            outputBytes += chunk.length
            restored.update(chunk)
          }
        },
        onBufferedBytes: (bytes) => {
          peakBuffered = Math.max(peakBuffered, bytes)
        },
      }
    )
    expect(outputBytes).toBe(data.length)
    expect(restored.digest('hex')).toBe(createHash('sha256').update(data).digest('hex'))
    expect(peakBuffered).toBeLessThanOrEqual(1100 * 1024)
    expect(readBytes.mock.calls.length).toBeLessThanOrEqual(Math.ceil(archive.length / (64 * 1024)) + 8)
  }
)
