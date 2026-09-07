import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Resolve symlinks with the same native semantics as fs.promises.realpath(). */
export function safeRealpathSync(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return path.normalize(p)
  }
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// True when a resolved absolute path is the filesystem root, the user's home, an ancestor
// of home, or a system dir. These roots are too broad or sensitive for approval-free agent access.
export function isUnsafeResolvedPath(resolved: string): boolean {
  if (!resolved || resolved === path.parse(resolved).root) return true
  const home = homedir()
  if (home && (resolved === home || pathContains(resolved, home))) return true
  if (process.platform === 'win32') {
    const windowsSystemRoots = [
      process.env.SystemRoot,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ]
    for (const systemRoot of windowsSystemRoots) {
      if (!systemRoot) continue
      const normalizedRoot = path.resolve(systemRoot)
      if (resolved === normalizedRoot || pathContains(normalizedRoot, resolved)) return true
    }
  }
  const systemRoots = [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/var',
    '/System',
    '/Library',
    '/private',
    '/boot',
    '/dev',
    '/proc',
    '/opt',
    '/root',
  ]
  return systemRoots.some((systemRoot) => resolved === systemRoot || pathContains(systemRoot, resolved))
}
