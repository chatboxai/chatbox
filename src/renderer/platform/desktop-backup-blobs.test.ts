import { expect, it } from 'vitest'
import { desktopBackupBlobs } from './desktop-backup-blobs'

it('preserves BOM and Unicode across bounded native reads and writes', async () => {
  const source = '\ufeff' + '🙂中'.repeat(20000)
  const bytes = new TextEncoder().encode(source)
  const output: Uint8Array[] = []
  let maximum = 0
  const blobs = desktopBackupBlobs({
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === 'backup:blob-open') return { token: 'read', size: bytes.length }
      if (channel === 'backup:blob-create') return 'write'
      if (channel === 'backup:file-read') {
        maximum = Math.max(maximum, Number(args[2]))
        return bytes.slice(Number(args[1]), Number(args[1]) + Number(args[2]))
      }
      if (channel === 'backup:file-write') {
        const part = args[1] as Uint8Array
        maximum = Math.max(maximum, part.length)
        output.push(part)
      }
    },
  })
  const read = await blobs.read('source')
  const parts: string[] = []
  for await (const part of read!) parts.push(part)
  expect(parts.join('')).toBe(source)
  await blobs.write(
    'destination',
    (async function* () {
      for (let i = 0; i < source.length; i += 17000) yield source.slice(i, i + 17000)
    })()
  )
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(Buffer.concat(output))).toBe(source)
  expect(maximum).toBeLessThanOrEqual(65536)
})
