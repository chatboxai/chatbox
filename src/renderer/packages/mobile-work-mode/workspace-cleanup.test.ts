import { describe, expect, it, vi } from 'vitest'
import {
  autoCleanupWorkspaces,
  cleanupStaleWorkspaces,
  DAY_MS,
  formatBytes,
  isStaleWorkspace,
  listWorkspaceUsage,
  normalizeMtime,
} from './workspace-cleanup'

/**
 * Minimal in-memory Capacitor filesystem: paths are absolute-ish keys such as `workspaces/ab/out/x`.
 * A directory's mtime is the newest mtime below it unless explicitly set.
 */
function createFakeFilesystem(tree: Record<string, { size?: number; mtime?: number; dir?: boolean }>) {
  const entries = new Map(Object.entries(tree))
  const removed: string[] = []
  const filesystem = {
    async readdir({ path }: { path: string }) {
      const prefix = `${path}/`
      const names = new Map<string, { name: string; type: 'file' | 'directory'; size: number; mtime: number }>()
      for (const [key, value] of entries) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const [head] = rest.split('/')
        if (!head) continue
        const isDirectory = rest.includes('/') || value.dir === true
        names.set(head, {
          name: head,
          type: isDirectory ? 'directory' : 'file',
          size: isDirectory ? 0 : (value.size ?? 0),
          mtime: value.mtime ?? 0,
        })
      }
      if (names.size === 0) {
        const error = new Error('Folder does not exist') as Error & { code: string }
        error.code = 'OS-PLUG-FILE-0008'
        throw error
      }
      return { files: [...names.values()] }
    },
    async rmdir({ path }: { path: string }) {
      for (const key of [...entries.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) entries.delete(key)
      }
      removed.push(path)
    },
  }
  return { filesystem, removed }
}

const NOW = 1_700_000_000_000
const daysAgo = (days: number) => NOW - days * DAY_MS

describe('workspace-cleanup helpers', () => {
  it('normalises seconds and milliseconds into milliseconds', () => {
    expect(normalizeMtime(1_700_000_000)).toBe(1_700_000_000_000)
    expect(normalizeMtime(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(normalizeMtime(0)).toBeNull()
    expect(normalizeMtime(undefined)).toBeNull()
    expect(normalizeMtime(Number.NaN)).toBeNull()
  })

  it('formats bytes for the settings label', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(52_428_800)).toBe('50 MB')
  })

  it('treats workspaces without a timestamp as in use', () => {
    expect(isStaleWorkspace({ modifiedAt: null }, NOW, 30)).toBe(false)
    expect(isStaleWorkspace({ modifiedAt: daysAgo(31) }, NOW, 30)).toBe(true)
    expect(isStaleWorkspace({ modifiedAt: daysAgo(29) }, NOW, 30)).toBe(false)
  })
})

describe('listWorkspaceUsage', () => {
  it('measures nested files and uses the newest file timestamp', async () => {
    const { filesystem } = createFakeFilesystem({
      'workspaces/a1': { dir: true, mtime: daysAgo(90) },
      'workspaces/a1/output/chart.png': { size: 1024, mtime: daysAgo(2) },
      'workspaces/a1/input/photo.heic': { size: 2048, mtime: daysAgo(5) },
      'workspaces/b2': { dir: true },
      'workspaces/b2/notes.txt': { size: 10, mtime: daysAgo(60) },
    })
    const summary = await listWorkspaceUsage(filesystem as never)
    expect(summary.workspaces).toHaveLength(2)
    expect(summary.totalBytes).toBe(1024 + 2048 + 10)
    expect(summary.totalFiles).toBe(3)
    const a1 = summary.workspaces.find((workspace) => workspace.name === 'a1')
    expect(a1?.bytes).toBe(3072)
    // Directory mtime is 90 days old, but its newest file is 2 days old, so it is still in use.
    expect(a1?.modifiedAt).toBe(daysAgo(2))
  })

  it('returns an empty summary when the workspace root does not exist yet', async () => {
    const { filesystem } = createFakeFilesystem({})
    await expect(listWorkspaceUsage(filesystem as never)).resolves.toEqual({
      workspaces: [],
      totalBytes: 0,
      totalFiles: 0,
    })
  })
})

describe('cleanupStaleWorkspaces', () => {
  it('removes only workspaces older than the retention window', async () => {
    const { filesystem, removed } = createFakeFilesystem({
      'workspaces/old': { dir: true },
      'workspaces/old/output/big.bin': { size: 5_000, mtime: daysAgo(45) },
      'workspaces/recent': { dir: true },
      'workspaces/recent/output/big.bin': { size: 7_000, mtime: daysAgo(3) },
    })
    const result = await cleanupStaleWorkspaces({ retentionDays: 30, now: NOW, filesystem: filesystem as never })
    expect(result).toEqual({ scanned: 2, removed: 1, freedBytes: 5_000, failed: 0 })
    expect(removed).toEqual(['workspaces/old'])
  })

  it('keeps everything when the retention window is longer than any workspace', async () => {
    const { filesystem, removed } = createFakeFilesystem({
      'workspaces/a': { dir: true },
      'workspaces/a/x.txt': { size: 1, mtime: daysAgo(10) },
    })
    const result = await cleanupStaleWorkspaces({ retentionDays: 30, now: NOW, filesystem: filesystem as never })
    expect(result.removed).toBe(0)
    expect(removed).toEqual([])
  })
})

describe('autoCleanupWorkspaces', () => {
  function createStorage() {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    }
  }

  it('does nothing when the feature is disabled', async () => {
    const { filesystem } = createFakeFilesystem({})
    const result = await autoCleanupWorkspaces({
      enabled: false,
      retentionDays: 30,
      now: NOW,
      filesystem: filesystem as never,
      storage: createStorage(),
    })
    expect(result).toBeNull()
  })

  it('runs at most once per day', async () => {
    const storage = createStorage()
    const { filesystem } = createFakeFilesystem({
      'workspaces/old': { dir: true },
      'workspaces/old/f.bin': { size: 100, mtime: daysAgo(40) },
    })
    const first = await autoCleanupWorkspaces({
      enabled: true,
      retentionDays: 30,
      now: NOW,
      filesystem: filesystem as never,
      storage,
    })
    expect(first?.removed).toBe(1)
    const second = await autoCleanupWorkspaces({
      enabled: true,
      retentionDays: 30,
      now: NOW + 60_000,
      filesystem: filesystem as never,
      storage,
    })
    expect(second).toBeNull()
    const nextDay = await autoCleanupWorkspaces({
      enabled: true,
      retentionDays: 30,
      now: NOW + DAY_MS + 1,
      filesystem: filesystem as never,
      storage,
    })
    expect(nextDay).not.toBeNull()
  })
})
