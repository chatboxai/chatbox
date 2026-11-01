import { expect, it, vi } from 'vitest'
import { desktopResourceFiles } from './desktop-resource-files'

it('preserves raw stored bytes across bounded native reads and writes', async () => {
  const bytes = new TextEncoder().encode('\ufeff' + '🙂中'.repeat(20000))
  const output: Uint8Array[] = []
  let maximum = 0
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'file-transfer:open-resource') return { token: 'read', size: bytes.length }
    if (channel === 'file-transfer:create-resource') return 'write'
    if (channel === 'file-transfer:read') {
      maximum = Math.max(maximum, Number(args[2]))
      return bytes.slice(Number(args[1]), Number(args[1]) + Number(args[2]))
    }
    if (channel === 'file-transfer:write') {
      const part = args[1] as Uint8Array
      maximum = Math.max(maximum, part.length)
      output.push(part.slice())
    }
  })
  const files = desktopResourceFiles({ invoke })
  const source = await files.open('source')
  expect(source).not.toBeNull()
  expect(await source!.readBytes!(1, 100000)).toEqual(bytes.slice(1, 100001))
  const parts: Uint8Array[] = []
  for await (const part of source!.chunks!()) parts.push(part)
  expect(Buffer.concat(parts)).toEqual(Buffer.from(bytes))
  await source!.close()
  expect(
    invoke.mock.calls.filter(([channel, token]) => channel === 'file-transfer:finish' && token === 'read')
  ).toHaveLength(1)
  const target = await files.create('destination')
  await target.write(bytes)
  await target.close()
  expect(Buffer.concat(output)).toEqual(Buffer.from(bytes))
  expect(maximum).toBeLessThanOrEqual(65536)
  await expect(target.write(bytes)).rejects.toThrow('closed')
})

it('releases an input handle after an interrupted read and permits aborting an uncommitted output', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'file-transfer:open-resource') return { token: 'read', size: 1 }
    if (channel === 'file-transfer:create-resource') return 'write'
    if (channel === 'file-transfer:read') return new Uint8Array()
  })
  const files = desktopResourceFiles({ invoke })
  const source = await files.open('source')
  await expect(source!.chunks!()[Symbol.asyncIterator]().next()).rejects.toThrow('changed')
  expect(invoke).toHaveBeenCalledWith('file-transfer:finish', 'read', false)
  const target = await files.create('destination')
  await target.abort()
  expect(invoke).toHaveBeenCalledWith('file-transfer:finish', 'write', false)
})
