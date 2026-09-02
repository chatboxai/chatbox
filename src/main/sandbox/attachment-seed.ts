import path from 'node:path'

/** Sidecar in the session working directory that records which attachment blob seeded each destination path. */
export const ATTACHMENT_SEED_MANIFEST_NAME = '.chatbox-attachment-seeds.json'

export function isAttachmentSeedManifestName(name: string): boolean {
  const streamSeparator = name.indexOf(':')
  const baseName = streamSeparator >= 0 ? name.slice(0, streamSeparator) : name
  return baseName.replace(/[. ]+$/u, '').toLowerCase() === ATTACHMENT_SEED_MANIFEST_NAME.toLowerCase()
}

/** True when any segment of the path names the seed manifest (guards writes to it). */
export function pathContainsAttachmentSeedManifest(targetPath: string): boolean {
  return path
    .normalize(targetPath)
    .split(path.sep)
    .some((segment) => isAttachmentSeedManifestName(segment))
}

export function parseAttachmentSeedManifest(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const files: Record<string, string> = {}
    for (const [name, key] of Object.entries(parsed)) {
      if (typeof name !== 'string' || typeof key !== 'string' || name.length === 0 || key.length === 0) continue
      if (isAttachmentSeedManifestName(name)) continue
      if (name.split(/[\\/]/).some((segment) => segment === '..' || segment === '')) continue
      files[name] = key
    }
    return files
  } catch {
    return {}
  }
}

export type AttachmentSeedWriteAction = 'write' | 'skip' | 'reconcile' | 'relocate'

/**
 * Decide what a seed copy should do with the destination file.
 * - `write`: destination missing. Write the incoming blob.
 * - `skip`: same blob already seeded here (possibly edited since). Keep the working copy.
 * - `reconcile`: the file exists but has no manifest entry — a model-created file, a
 *   seed from before the manifest existed, or a seed whose manifest entry was lost.
 *   Never overwrite it; the caller may record a baseline when the on-disk bytes still
 *   equal the incoming blob, or relocate the incoming blob when they differ so both
 *   files remain (keeping the working copy when the blob's own identity path is the
 *   occupied destination and there is nowhere to relocate to).
 * - `relocate`: destination is already occupied by a different attachment. Filenames are
 *   not identity — write the incoming blob to its own path instead of replacing the file.
 */
export function classifyAttachmentSeedWrite(
  destExists: boolean,
  previousBlobKey: string | undefined,
  incomingBlobKey: string
): AttachmentSeedWriteAction {
  if (!destExists) return 'write'
  if (previousBlobKey === undefined) return 'reconcile'
  return previousBlobKey === incomingBlobKey ? 'skip' : 'relocate'
}

export interface AttachmentSeedKeySemantics {
  /** The host filesystem resolves paths case-insensitively (Windows, default APFS/HFS+). */
  caseInsensitive: boolean
  /** The host filesystem ignores trailing dots and spaces in names (Windows). */
  stripTrailingDotsAndSpaces: boolean
}

/**
 * Canonicalize a manifest key so that names the host filesystem treats as the same file
 * share one manifest entry.
 */
export function normalizeAttachmentSeedKey(key: string, semantics: AttachmentSeedKeySemantics): string {
  let normalized = key
  if (semantics.stripTrailingDotsAndSpaces) {
    normalized = normalized
      .split('/')
      .map((segment) => segment.replace(/[. ]+$/u, ''))
      .join('/')
  }
  return semantics.caseInsensitive ? normalized.toLowerCase() : normalized
}
