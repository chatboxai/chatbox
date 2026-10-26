import { expect, it, vi } from 'vitest'
import { cacheFileRanges } from './range-cache'
import { type ByteSource, readFileBytes } from './byte-source'

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
