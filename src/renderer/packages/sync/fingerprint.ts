import { readZipFileEntries } from '@chatbox/core/io'

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function fingerprintBackup(bytes: Uint8Array): Promise<string> {
  const entries: Array<{ path: string; hash: string }> = []
  await readZipFileEntries(
    new Blob([new Uint8Array(bytes)]),
    async (entry) => {
      if (entry.path === 'manifest.json' || entry.path === 'complete.json') return
      entries.push({ path: entry.path, hash: hex(await crypto.subtle.digest('SHA-256', new Uint8Array(entry.data))) })
    },
    { bounded: true }
  )
  entries.sort((a, b) => a.path.localeCompare(b.path))
  const canonical = entries.map((entry) => `${entry.path}\0${entry.hash}\n`).join('')
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
}
