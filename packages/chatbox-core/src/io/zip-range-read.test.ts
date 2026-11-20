import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import type { ByteSource } from './byte-source'
import { readZipFileEntries } from './zip'

it.each(['random', 'repeated'] as const)(
  'batches %s ZIP file reads while keeping decompression bounded',
  async (kind) => {
    const data =
      kind === 'random'
        ? Uint8Array.from(
            createHash('shake256', { outputLength: 2 * 1024 * 1024 })
              .update('range-read-fixture')
              .digest()
          )
        : new Uint8Array(8 * 1024 * 1024).fill(97)
    const archive = zipSync({ 'payload.bin': data }, { level: 6 })
    const readBytes = vi.fn(async (offset: number, length: number) => archive.slice(offset, offset + length))
    const file: ByteSource = {
      size: archive.length,
      readBytes,
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
    expect(readBytes.mock.calls.length).toBeLessThanOrEqual(Math.ceil(archive.length / (1024 * 1024)) + 8)
    for (const [, length] of readBytes.mock.calls) expect(length).toBeLessThanOrEqual(1024 * 1024)
  }
)

it('coalesces small directory/header reads and starts each scan with fresh bytes', async () => {
  const entries = Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => [`entry-${i}.txt`, new Uint8Array([1, 2, 3])])
  )
  let archive = zipSync(entries, { level: 0 })
  const readBytes = vi.fn(async (offset: number, length: number) => archive.slice(offset, offset + length))
  const file: ByteSource = {
    get size() {
      return archive.length
    },
    readBytes,
  }
  let count = 0
  await readZipFileEntries(
    file,
    (entry) => {
      expect(entry.data).toEqual(new Uint8Array([1, 2, 3]))
      count++
    },
    { bounded: true }
  )
  expect(count).toBe(400)
  expect(readBytes.mock.calls.length).toBeLessThan(10)
  archive = zipSync(Object.fromEntries(Object.keys(entries).map((name) => [name, new Uint8Array([4, 5, 6])])), {
    level: 0,
  })
  await readZipFileEntries(
    file,
    (entry) => {
      expect(entry.data).toEqual(new Uint8Array([4, 5, 6]))
    },
    { bounded: true }
  )
})

it.each([0, 6] as const)('rejects CRC corruption before a streamed level %i entry is accepted', async (level) => {
  const archive = zipSync({ 'payload.bin': new TextEncoder().encode('complete payload') }, { level })
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let central = -1
  for (let offset = 0; offset + 46 <= archive.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      central = offset
      break
    }
  }
  expect(central).toBeGreaterThanOrEqual(0)
  view.setUint32(central + 16, view.getUint32(central + 16, true) ^ 1, true)
  let accepted = false
  await expect(
    readZipFileEntries(
      { size: archive.length, readBytes: async (offset, length) => archive.slice(offset, offset + length) },
      () => {
        throw new Error('Expected streaming')
      },
      {
        bounded: true,
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          for await (const _ of entry.data) {
            /* A consumer may stage bytes, but cannot publish yet. */
          }
          accepted = true
        },
      }
    )
  ).rejects.toThrow('CRC mismatch')
  expect(accepted).toBe(false)
})

it('validates a later entry even when its corrupt bytes were prefetched with an earlier entry', async () => {
  const archive = zipSync(
    { 'first.bin': new Uint8Array(128 * 1024).fill(1), 'second.bin': new Uint8Array(128 * 1024).fill(2) },
    { level: 0 }
  )
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const second = 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true)
  expect(view.getUint32(second, true)).toBe(0x04034b50)
  const payload = second + 30 + view.getUint16(second + 26, true) + view.getUint16(second + 28, true)
  archive[payload + 65536] ^= 1
  const readBytes = vi.fn(async (offset: number, length: number) => archive.slice(offset, offset + length))
  const accepted: string[] = []
  await expect(
    readZipFileEntries({ size: archive.length, readBytes }, () => {}, {
      bounded: true,
      streamEntry: () => true,
      onStreamEntry: async (entry) => {
        for await (const _ of entry.data) {
          /* CRC must complete before acceptance. */
        }
        accepted.push(entry.path)
      },
    })
  ).rejects.toThrow('CRC mismatch')
  expect(accepted).toEqual(['first.bin'])
  expect(readBytes.mock.calls.some(([, length]) => length > 65536)).toBe(true)
})

it('stops consuming a prefetched body when cancelled without accepting the entry', async () => {
  const archive = zipSync({ 'payload.bin': new Uint8Array(2 * 1024 * 1024).fill(1) }, { level: 0 })
  const controller = new AbortController()
  let consumed = 0
  let accepted = false
  await expect(
    readZipFileEntries(
      { size: archive.length, readBytes: async (offset, length) => archive.slice(offset, offset + length) },
      () => {},
      {
        bounded: true,
        signal: controller.signal,
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          for await (const chunk of entry.data) {
            consumed += chunk.length
            controller.abort(new Error('cancelled after first output'))
          }
          accepted = true
        },
      }
    )
  ).rejects.toThrow('cancelled after first output')
  expect(consumed).toBe(65536)
  expect(accepted).toBe(false)
})
