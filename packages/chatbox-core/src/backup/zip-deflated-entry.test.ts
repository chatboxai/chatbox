import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { inflateSync } from 'fflate'
import { expect, it } from 'vitest'
import { deflateZipData } from './zip'

it.each([0, 1, 256 * 1024, 1024 * 1024 + 17])(
  'compresses a %i-byte entry body in steps with its ZIP checksum',
  async (length) => {
    const bytes = Uint8Array.from(
      createHash('shake256', { outputLength: length }).update('deflated-entry').digest(),
      (value, index) => (index % 3 === 0 ? 97 : value)
    )
    const data = await deflateZipData(bytes)

    expect(data.size).toBe(length)
    // A gzip trailer carries the CRC-32 of its input.
    const gzip = gzipSync(bytes)
    expect(data.crc >>> 0).toBe(gzip.readUInt32LE(gzip.length - 8))
    expect(inflateSync(data.deflated)).toEqual(bytes)
  }
)

it('lets other tasks run between steps and stops when they abort it', async () => {
  const bytes = Uint8Array.from(
    createHash('shake256', { outputLength: 16 * 1024 * 1024 })
      .update('abort')
      .digest()
  )
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 0)

  await expect(deflateZipData(bytes, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
