import { Directory, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import { getLogger } from '@/lib/utils'

const log = getLogger('workspace-cleanup')

/** Root directory (inside `Directory.Data`) that holds one folder per session. */
export const WORKSPACE_ROOT = 'workspaces'

export const DAY_MS = 24 * 60 * 60 * 1000

export const WORKSPACE_RETENTION_OPTIONS = [7, 14, 30, 60, 90] as const
export const DEFAULT_WORKSPACE_RETENTION_DAYS = 30

const CLEANUP_STAMP_KEY = 'chatbox:workspace-cleanup:last-run'
const AUTO_CLEANUP_INTERVAL_MS = DAY_MS

export interface WorkspaceUsage {
  /** Directory name (hex-encoded session id). */
  name: string
  bytes: number
  files: number
  /** Last modification time in milliseconds, or `null` when the platform reports none. */
  modifiedAt: number | null
}

export interface WorkspaceUsageSummary {
  workspaces: WorkspaceUsage[]
  totalBytes: number
  totalFiles: number
}

export interface WorkspaceCleanupResult {
  scanned: number
  removed: number
  freedBytes: number
  failed: number
}

/**
 * Capacitor reports `mtime` in milliseconds on Android/iOS, but older versions of the plugin and
 * some platforms hand back seconds; normalise both so comparisons cannot be off by 1000x.
 */
export function normalizeMtime(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 1e12 ? value * 1000 : value
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** A workspace is stale when its last write is older than the retention window. */
export function isStaleWorkspace(usage: Pick<WorkspaceUsage, 'modifiedAt'>, now: number, retentionDays: number): boolean {
  if (!usage.modifiedAt) return false
  return now - usage.modifiedAt > retentionDays * DAY_MS
}

async function measureDirectory(
  filesystem: FilesystemPlugin,
  path: string,
  usage: WorkspaceUsage
): Promise<void> {
  const { files } = await filesystem.readdir({ path, directory: Directory.Data })
  for (const entry of files) {
    if (entry.type === 'directory') {
      await measureDirectory(filesystem, `${path}/${entry.name}`, usage)
      continue
    }
    usage.files += 1
    usage.bytes += Math.max(0, entry.size ?? 0)
    // A directory's own mtime does not change when a nested file is rewritten, so the newest file
    // timestamp decides whether the workspace was actually used recently.
    const modified = normalizeMtime(entry.mtime)
    if (modified && (!usage.modifiedAt || modified > usage.modifiedAt)) usage.modifiedAt = modified
  }
}

/**
 * Lists every workspace directory with its size and last modification time.
 * Missing/unreadable entries are skipped instead of failing the whole scan.
 */
export async function listWorkspaceUsage(filesystem: FilesystemPlugin = Filesystem): Promise<WorkspaceUsageSummary> {
  const workspaces: WorkspaceUsage[] = []
  let entries: Awaited<ReturnType<FilesystemPlugin['readdir']>>['files'] = []
  try {
    entries = (await filesystem.readdir({ path: WORKSPACE_ROOT, directory: Directory.Data })).files
  } catch (error) {
    if (!isMissingPathError(error)) log.warn('workspace root is unreadable', error)
    return { workspaces, totalBytes: 0, totalFiles: 0 }
  }
  for (const entry of entries) {
    if (entry.type !== 'directory') continue
    const usage: WorkspaceUsage = {
      name: entry.name,
      bytes: 0,
      files: 0,
      modifiedAt: normalizeMtime(entry.mtime),
    }
    try {
      await measureDirectory(filesystem, `${WORKSPACE_ROOT}/${entry.name}`, usage)
    } catch (error) {
      if (!isMissingPathError(error)) log.warn('workspace directory is unreadable', entry.name, error)
      continue
    }
    workspaces.push(usage)
  }
  return {
    workspaces,
    totalBytes: workspaces.reduce((sum, item) => sum + item.bytes, 0),
    totalFiles: workspaces.reduce((sum, item) => sum + item.files, 0),
  }
}

/** Deletes every workspace whose last write is older than `retentionDays`. */
export async function cleanupStaleWorkspaces(options: {
  retentionDays: number
  now?: number
  filesystem?: FilesystemPlugin
}): Promise<WorkspaceCleanupResult> {
  const { retentionDays } = options
  const now = options.now ?? Date.now()
  const filesystem = options.filesystem ?? Filesystem
  const summary = await listWorkspaceUsage(filesystem)
  const result: WorkspaceCleanupResult = { scanned: summary.workspaces.length, removed: 0, freedBytes: 0, failed: 0 }
  for (const workspace of summary.workspaces) {
    if (!isStaleWorkspace(workspace, now, retentionDays)) continue
    try {
      await filesystem.rmdir({ path: `${WORKSPACE_ROOT}/${workspace.name}`, directory: Directory.Data, recursive: true })
      result.removed += 1
      result.freedBytes += workspace.bytes
    } catch (error) {
      if (isMissingPathError(error)) continue
      result.failed += 1
      log.warn('failed to remove workspace', workspace.name, error)
    }
  }
  if (result.removed > 0) {
    log.info(
      `removed ${result.removed} stale workspace(s), freed ${formatBytes(result.freedBytes)} (retention ${retentionDays}d)`
    )
  }
  return result
}

/**
 * Runs the daily background cleanup. Nothing happens when the feature is disabled, when another
 * run already happened today, or on platforms without the Capacitor filesystem.
 */
export async function autoCleanupWorkspaces(options: {
  enabled: boolean
  retentionDays: number
  now?: number
  filesystem?: FilesystemPlugin
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}): Promise<WorkspaceCleanupResult | null> {
  if (!options.enabled) return null
  const now = options.now ?? Date.now()
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage
  const lastRun = Number(storage?.getItem(CLEANUP_STAMP_KEY) ?? 0)
  if (Number.isFinite(lastRun) && now - lastRun < AUTO_CLEANUP_INTERVAL_MS) return null
  const result = await cleanupStaleWorkspaces({
    retentionDays: options.retentionDays,
    now,
    filesystem: options.filesystem,
  })
  storage?.setItem(CLEANUP_STAMP_KEY, String(now))
  return result
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isMissingPathError(error: unknown): boolean {
  // Capacitor reports a missing path as OS-PLUG-FILE-0008 on Android/iOS.
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'OS-PLUG-FILE-0008')
}
