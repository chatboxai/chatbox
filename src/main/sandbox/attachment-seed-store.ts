import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  ATTACHMENT_SEED_MANIFEST_NAME,
  type AttachmentSeedKeySemantics,
  type AttachmentSeedWriteAction,
  classifyAttachmentSeedWrite,
  normalizeAttachmentSeedKey,
  parseAttachmentSeedManifest,
} from './attachment-seed'

/**
 * On-disk store for the attachment seed manifest — the sidecar in each session working
 * directory that records which blob seeded each destination path (see `attachment-seed.ts`
 * for the pure decision logic). All manifest reads and writes go through this module;
 * every read-modify-write here is synchronous end to end, which is what makes concurrent
 * copyBlobToSandbox calls safe. Do not add awaits between a load and its save.
 */

const workDirCaseInsensitivityCache = new Map<string, boolean>()

function flipAsciiCase(name: string): string {
  return name.replace(/[a-zA-Z]/g, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
}

/**
 * Probe whether the filesystem hosting workDir resolves paths case-insensitively, by
 * stat-ing a case-flipped alias of the nearest ancestor whose name contains a letter.
 * Falls back to the platform default (Windows and macOS ship case-insensitive by default).
 */
function isWorkDirCaseInsensitive(workDir: string): boolean {
  const cached = workDirCaseInsensitivityCache.get(workDir)
  if (cached !== undefined) return cached
  const platformDefault = process.platform === 'win32' || process.platform === 'darwin'
  let result = platformDefault
  try {
    let dir = workDir
    for (let depth = 0; depth < 40; depth++) {
      const base = path.basename(dir)
      const parent = path.dirname(dir)
      const flipped = flipAsciiCase(base)
      if (flipped !== base && existsSync(dir)) {
        const original = statSync(dir)
        const flippedPath = path.join(parent, flipped)
        result =
          existsSync(flippedPath) &&
          (() => {
            const alias = statSync(flippedPath)
            return alias.ino === original.ino && alias.dev === original.dev
          })()
        break
      }
      if (parent === dir) break
      dir = parent
    }
  } catch {
    result = platformDefault
  }
  workDirCaseInsensitivityCache.set(workDir, result)
  return result
}

function attachmentSeedKeySemantics(workDir: string): AttachmentSeedKeySemantics {
  return {
    caseInsensitive: isWorkDirCaseInsensitive(workDir),
    stripTrailingDotsAndSpaces: process.platform === 'win32',
  }
}

function attachmentSeedManifestKey(workDir: string, targetPath: string): string {
  const key = path.relative(workDir, targetPath).split(path.sep).join('/')
  return normalizeAttachmentSeedKey(key, attachmentSeedKeySemantics(workDir))
}

/** lstat without following symlinks; undefined when the path does not exist. */
function lstatIfExists(targetPath: string): Stats | undefined {
  try {
    return lstatSync(targetPath)
  } catch {
    return undefined
  }
}

function loadAttachmentSeedManifest(workDir: string): Record<string, string> {
  const manifestPath = path.join(workDir, ATTACHMENT_SEED_MANIFEST_NAME)
  const manifestStat = lstatIfExists(manifestPath)
  // A sandbox task can replace the sidecar with a symlink or FIFO. Never read through it:
  // a symlink would pull outside bytes into the parse and a FIFO would block the main
  // process forever. A planted entry counts as no manifest — reconcile then self-heals.
  if (!manifestStat?.isFile()) return {}
  let parsed: Record<string, string>
  try {
    parsed = parseAttachmentSeedManifest(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return {}
  }
  // Older manifests may hold non-canonical keys (e.g. mixed case); normalize on load.
  const semantics = attachmentSeedKeySemantics(workDir)
  const normalized: Record<string, string> = {}
  for (const [name, blobKey] of Object.entries(parsed)) {
    normalized[normalizeAttachmentSeedKey(name, semantics)] = blobKey
  }
  return normalized
}

// O_NOFOLLOW closes the lstat→write race on POSIX; it is undefined on Windows, where the
// lstat guard alone has to do (planting a file symlink there needs a privilege anyway).
const MANIFEST_WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0)

function saveAttachmentSeedManifest(workDir: string, files: Record<string, string>): void {
  const manifestPath = path.join(workDir, ATTACHMENT_SEED_MANIFEST_NAME)
  // This write runs in the main process and bypasses the sandbox write allowlist, so it
  // must never follow a link a sandbox task planted at the manifest path. Remove anything
  // that is not a regular file (the link itself, not its target) before writing.
  const manifestStat = lstatIfExists(manifestPath)
  if (manifestStat && !manifestStat.isFile()) rmSync(manifestPath, { force: true, recursive: true })
  const fd = openSync(manifestPath, MANIFEST_WRITE_FLAGS, 0o644)
  try {
    writeFileSync(fd, `${JSON.stringify(files)}\n`, 'utf-8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Decide what a seed copy should do with this destination, and under which manifest key
 * a subsequent recordAttachmentSeed() should file it.
 */
export function classifyAttachmentSeedCopyAgainstManifest(
  workDir: string,
  targetPath: string,
  incomingBlobKey: string,
  manifest: Record<string, string>
): { action: AttachmentSeedWriteAction; seedKey: string } {
  const seedKey = attachmentSeedManifestKey(workDir, targetPath)
  const destExists = existsSync(targetPath) && statSync(targetPath).isFile()
  return { action: classifyAttachmentSeedWrite(destExists, manifest[seedKey], incomingBlobKey), seedKey }
}

export function classifyAttachmentSeedCopy(
  workDir: string,
  targetPath: string,
  incomingBlobKey: string
): { action: AttachmentSeedWriteAction; seedKey: string } {
  return classifyAttachmentSeedCopyAgainstManifest(
    workDir,
    targetPath,
    incomingBlobKey,
    loadAttachmentSeedManifest(workDir)
  )
}

/** Snapshot the sidecar once so a batch reseed can skip existing files without rereading it. */
export function readAttachmentSeedManifest(workDir: string): Record<string, string> {
  return loadAttachmentSeedManifest(workDir)
}

/**
 * Record a seeded blob in the manifest. Reloads the manifest synchronously right before
 * writing: concurrent copyBlobToSandbox calls for other attachments complete between the
 * caller's awaits, and saving a stale in-memory snapshot would drop their entries.
 */
export function recordAttachmentSeed(workDir: string, seedKey: string, blobKey: string): void {
  const manifest = loadAttachmentSeedManifest(workDir)
  manifest[seedKey] = blobKey
  saveAttachmentSeedManifest(workDir, manifest)
}
