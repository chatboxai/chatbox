/**
 * Sandbox destinations for user uploads.
 *
 * Filenames are display labels, not identity. Two uploads can both be named
 * `report.html` and both be needed. Destinations are therefore derived from a
 * stable attachment identity (`rawStorageKey || storageKey || id`) so the
 * prompt's `<SANDBOX_PATH>` and the seeder always agree.
 */

export const SANDBOX_ATTACHMENT_DIR = 'attachments'

export type SandboxSeedAttachment = {
  name: string
  storageKey: string
  rawStorageKey?: string
  id?: string
}

export function sandboxAttachmentIdentity(file: { rawStorageKey?: string; storageKey?: string; id?: string }): string {
  return file.rawStorageKey || file.storageKey || file.id || ''
}

/**
 * Deterministic 12-hex fingerprint. Sync and browser-safe (no `node:crypto`).
 * Not a security hash — only a collision-resistant directory name.
 */
export function sandboxAttachmentFingerprint(identity: string): string {
  let h1 = 2166136261
  let h2 = 2166136261 ^ 0x9e3779b9
  for (let i = 0; i < identity.length; i++) {
    const code = identity.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 16777619)
    h2 = Math.imul(h2 ^ code, 16777619)
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0')
  const b = (h2 >>> 0).toString(16).padStart(8, '0')
  return `${a}${b}`.slice(0, 12)
}

export function sanitizeSandboxAttachmentFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop()?.trim() || 'file'
  let cleaned = ''
  for (let i = 0; i < base.length; i++) {
    const code = base.charCodeAt(i)
    cleaned += code < 32 ? '_' : base[i]
  }
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned
}

export function sandboxAttachmentRelPath(fileName: string, identity: string): string {
  const base = sanitizeSandboxAttachmentFileName(fileName)
  if (!identity) return base
  return `${SANDBOX_ATTACHMENT_DIR}/${sandboxAttachmentFingerprint(identity)}/${base}`
}

export function sandboxAttachmentParsedRelPath(relPath: string): string {
  return `${relPath}_parsed.txt`
}

export function toSandboxSeedAttachment(file: {
  name: string
  storageKey?: string
  rawStorageKey?: string
  id?: string
}): SandboxSeedAttachment {
  return {
    name: file.name,
    storageKey: file.storageKey || '',
    rawStorageKey: file.rawStorageKey,
    id: file.id,
  }
}
