import { expect, it, vi } from 'vitest'
import { type ByteSource, readFileBytes } from './byte-source'
import { cacheFileRanges } from './range-cache'

function fixture() {
  const data = Uint8Array.from({ length: 6 * 64 * 1024 + 17 }, (_, i) => i % 251)
  const readBytes = vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length))
  const file: ByteSource = { size: data.length, readBytes }
  return { data, readBytes, file }
}

it('reuses nearby reads, preserves cross-block/EOF bytes and isolates returned buffers', async () => {
  const { data, readBytes, file } = fixture()
  const cached = cacheFileRanges(file)
  const first = await readFileBytes(cached, 100, 46)
  first.fill(0)
  expect(await readFileBytes(cached, 100, 46)).toEqual(data.slice(100, 146))
  expect(readBytes).toHaveBeenCalledTimes(1)
  expect(await readFileBytes(cached, 65530, 100)).toEqual(data.slice(65530, 65630))
  expect(await readFileBytes(cached, data.length - 10, 100)).toEqual(data.slice(-10))
  expect(await readFileBytes(cached, data.length, 1)).toHaveLength(0)
  for (const [, length] of readBytes.mock.calls) expect(length).toBeLessThanOrEqual(64 * 1024)
  await expect(readFileBytes(cached, -1, 1)).rejects.toThrow('offset')
  await expect(readFileBytes(cached, 0, -1)).rejects.toThrow('length')
})

it('retains only the four most recently used blocks', async () => {
  const { readBytes, file } = fixture()
  const cached = cacheFileRanges(file)
  for (const block of [0, 1, 2, 3, 0, 4, 0]) await readFileBytes(cached, block * 65536, 1)
  expect(readBytes).toHaveBeenCalledTimes(5)
  await readFileBytes(cached, 65536, 1)
  expect(readBytes).toHaveBeenCalledTimes(6)
})

it('does not retain failed reads or reuse bytes between scans', async () => {
  const { data, readBytes, file } = fixture()
  const cached = cacheFileRanges(file)
  readBytes.mockRejectedValueOnce(new Error('read failed'))
  await expect(readFileBytes(cached, 0, 8)).rejects.toThrow('read failed')
  expect(await readFileBytes(cached, 0, 8)).toEqual(data.slice(0, 8))
  data[0] = 99
  expect((await readFileBytes(cacheFileRanges(file), 0, 8))[0]).toBe(99)
})

it('rejects truncated blocks and cancellation on both misses and hits', async () => {
  const { readBytes, file } = fixture()
  readBytes.mockResolvedValueOnce(new Uint8Array(1))
  await expect(readFileBytes(cacheFileRanges(file), 0, 8)).rejects.toThrow('ended unexpectedly')
  const controller = new AbortController()
  const cached = cacheFileRanges(file, controller.signal)
  await readFileBytes(cached, 0, 8)
  controller.abort(new Error('cancelled'))
  await expect(readFileBytes(cached, 0, 8)).rejects.toThrow('cancelled')
  await expect(readFileBytes(cached, 65536, 8)).rejects.toThrow('cancelled')
})

it('reuses body read-ahead for headers, spans boundaries and isolates returned buffers', async () => {
  const data = Uint8Array.from({ length: 3 * 1024 * 1024 + 17 }, (_, i) => i % 251)
  const readBytes = vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length))
  const cached = cacheFileRanges({ size: data.length, readBytes })
  const first = await cached.readAheadBytes(100, 65536)
  expect(first).toEqual(data.slice(100, 100 + 65536))
  first.fill(0)
  expect(await cached.readBytes(300000, 46)).toEqual(data.slice(300000, 300046))
  expect(readBytes).toHaveBeenCalledTimes(1)
  expect(await cached.readAheadBytes(1024 * 1024 - 10, 65536)).toEqual(
    data.slice(1024 * 1024 - 10, 1024 * 1024 - 10 + 65536)
  )
  expect(readBytes).toHaveBeenCalledTimes(2)
  expect(await cached.readBytes(100, 65536)).toEqual(data.slice(100, 100 + 65536))
  expect(await cached.readAheadBytes(data.length - 10, 65536)).toEqual(data.slice(-10))
  expect(await cached.readAheadBytes(data.length, 65536)).toHaveLength(0)
  for (const [, length] of readBytes.mock.calls) expect(length).toBeLessThanOrEqual(1024 * 1024)
  await expect(cached.readAheadBytes(-1, 1)).rejects.toThrow('offset')
  await expect(cached.readAheadBytes(0, -1)).rejects.toThrow('length')
})

it('evicts old body ranges and keeps short payloads on small reads', async () => {
  const data = new Uint8Array(5 * 1024 * 1024)
  const readBytes = vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length))
  const cached = cacheFileRanges({ size: data.length, readBytes })
  await cached.readAheadBytes(0, 20)
  expect(readBytes.mock.calls[0][1]).toBe(65536)
  for (const block of [0, 1, 2, 2, 1]) await cached.readAheadBytes(block * 1024 * 1024, 65536)
  expect(readBytes).toHaveBeenCalledTimes(4)
  await cached.readAheadBytes(0, 65536)
  expect(readBytes).toHaveBeenCalledTimes(5)
})

it('does not cache failed, truncated or cancelled read-ahead', async () => {
  const { data, readBytes, file } = fixture()
  const cached = cacheFileRanges(file)
  readBytes.mockRejectedValueOnce(new Error('read failed'))
  await expect(cached.readAheadBytes(0, 65536)).rejects.toThrow('read failed')
  readBytes.mockResolvedValueOnce(new Uint8Array(1))
  await expect(cached.readAheadBytes(0, 65536)).rejects.toThrow('ended unexpectedly')
  expect(await cached.readAheadBytes(0, 65536)).toEqual(data.slice(0, 65536))
  const controller = new AbortController()
  const cancelled = cacheFileRanges(file, controller.signal)
  readBytes.mockImplementationOnce((offset, length) => {
    controller.abort(new Error('cancelled'))
    return Promise.resolve(data.slice(offset, offset + length))
  })
  await expect(cancelled.readAheadBytes(0, 65536)).rejects.toThrow('cancelled')
  await expect(cancelled.readBytes(0, 1)).rejects.toThrow('cancelled')
})
