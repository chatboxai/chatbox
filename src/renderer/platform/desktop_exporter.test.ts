import { expect, it, vi } from 'vitest'
import DesktopExporter from './desktop_exporter'

it('commits output only after all bounded writes finish', async () => {
  const invoke = vi.fn(async (channel: string) => (channel === 'file-transfer:open-save' ? 'output' : undefined))
  const exporter = new DesktopExporter({ invoke })
  await expect(
    exporter.exportStreamingFile(
      'export.zip',
      async function* () {
        yield new Uint8Array(65537)
      },
      'application/zip'
    )
  ).resolves.toEqual({ boundedMemory: true })
  const writes = invoke.mock.calls.filter(([channel]) => channel === 'file-transfer:write')
  expect(writes).toHaveLength(2)
  expect(invoke).toHaveBeenLastCalledWith('file-transfer:finish', 'output', true)
})

it('aborts partial output and preserves the write error if cleanup also fails', async () => {
  const error = new Error('Disk full')
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'file-transfer:open-save') return 'output'
    if (channel === 'file-transfer:write') throw error
    if (channel === 'file-transfer:finish') throw new Error('Cleanup failed')
  })
  const exporter = new DesktopExporter({ invoke })
  await expect(
    exporter.exportStreamingFile(
      'export.zip',
      async function* () {
        yield new Uint8Array([1])
      },
      'application/zip'
    )
  ).rejects.toBe(error)
  expect(invoke).toHaveBeenLastCalledWith('file-transfer:finish', 'output', false)
})

it('checks cancellation after the final chunk before publishing', async () => {
  const controller = new AbortController()
  const invoke = vi.fn(async (channel: string) => (channel === 'file-transfer:open-save' ? 'output' : undefined))
  await expect(
    new DesktopExporter({ invoke }).exportStreamingFile(
      'export.zip',
      async function* () {
        yield new Uint8Array([1])
        controller.abort()
      },
      'application/zip',
      controller.signal
    )
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(invoke).toHaveBeenLastCalledWith('file-transfer:finish', 'output', false)
})
