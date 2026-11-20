import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DeepSeekDownloads } from './deepseek-download'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function downloads(fetchFile: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-download-test-'))
  directories.push(root)
  return { manager: new DeepSeekDownloads(root, fetchFile), root }
}
it('preserves signed query bytes, omits credentials and exposes only owner-scoped local reads', async () => {
  const fetchFile = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(Uint8Array.of(80, 75, 3, 4), { headers: { 'content-length': '4' } }))
  const { manager, root } = await downloads(fetchFile),
    id = randomUUID()
  const url = 'https://example.com/export.zip?Signature=a%2Bb%3D&Expires=123'
  expect(await manager.start(1, id, url)).toEqual({ size: 4 })
  expect(fetchFile).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) })
  )
  expect(await manager.read(1, id, 0, 4)).toEqual(Uint8Array.of(80, 75, 3, 4))
  await expect(manager.read(2, id, 0, 4)).rejects.toThrow('unavailable')
  expect(manager.progress(1, id)).toMatchObject({ received: 4, total: 4 })
  await manager.close(1, id)
  expect(await readdir(root)).toEqual([])
})
it('reports HTTP failure without treating every failure as cancellation or leaking signed links', async () => {
  const { manager, root } = await downloads(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })))
  await expect(manager.start(1, randomUUID(), 'https://example.com/export?Signature=secret')).rejects.toThrow(
    'HTTP 403'
  )
  expect(await readdir(root)).toEqual([])
})
it('cancels a running download and removes the incomplete file', async () => {
  let requested = false
  const fetchFile: typeof fetch = async (_url, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          requested = true
          controller.enqueue(Uint8Array.of(80, 75))
          init?.signal?.addEventListener('abort', () => controller.error(new Error('cancelled')), { once: true })
        },
      })
    )
  const { manager, root } = await downloads(fetchFile),
    id = randomUUID()
  const pending = manager.start(1, id, 'https://example.com/export.zip')
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(requested).toBe(true))
  await manager.close(1, id)
  await rejected
  expect(await readdir(root)).toEqual([])
})
