import { spawnSync } from 'node:child_process'
import path from 'node:path'

export interface WindowsPowerShellResolution {
  kind: 'pwsh' | 'windows-powershell'
  cmd: string
  args: string[]
}

// `-Command -` consumes stdin as a pseudo-interactive prompt. Multiline input can be
// silently left unsubmitted at EOF, so read the complete UTF-8 payload as data and parse
// it once instead. Keep this bootstrap ASCII-only because it runs before stdin decoding is
// configured. Explicitly propagate native exit codes; PowerShell otherwise collapses them.
const POWERSHELL_STDIN_BOOTSTRAP = [
  '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  '$chatboxSource = [Console]::In.ReadToEnd() + "`n`$global:chatboxSucceeded = `$?"',
  '$chatboxScript = [ScriptBlock]::Create($chatboxSource)',
  '$global:LASTEXITCODE = 0',
  '$global:chatboxSucceeded = $false',
  'try { & $chatboxScript } catch {',
  '  $chatboxNodeExitCode = $_.Exception.Data["ChatboxNodeExitCode"]',
  '  if ($chatboxNodeExitCode -is [int]) { exit $chatboxNodeExitCode }',
  '  throw',
  '}',
  '$chatboxExitCode = $LASTEXITCODE',
  'if ($global:chatboxSucceeded) { exit 0 }',
  'if ($chatboxExitCode -is [int] -and $chatboxExitCode -ne 0) { exit $chatboxExitCode }',
  'exit 1',
].join('; ')
const POWERSHELL_STDIN_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', POWERSHELL_STDIN_BOOTSTRAP]
const POWERSHELL_PROBE_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']
const POWERSHELL_PROBE_TIMEOUT = 10_000

let cachedWindowsPowerShell: { cacheKey: string; resolution: WindowsPowerShellResolution } | undefined

function commandSucceeds(cmd: string, args: string[], timeout = 3_000): boolean {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout }).status === 0
  } catch {
    return false
  }
}

function getWindowsPowerShellCacheKey(): string {
  return [
    process.env.CHATBOX_POWERSHELL_PATH,
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.SystemRoot,
    process.env.PATH,
    process.cwd(),
  ]
    .map((value) => value ?? '')
    .join('\0')
}

function cacheWindowsPowerShell(
  cacheKey: string,
  resolution: WindowsPowerShellResolution
): WindowsPowerShellResolution {
  cachedWindowsPowerShell = { cacheKey, resolution }
  return resolution
}

/** Clear the successful PowerShell resolution cache. Primarily used by environment-sensitive tests. */
export function resetWindowsPowerShellResolutionCache(): void {
  cachedWindowsPowerShell = undefined
}

function findWindowsExecutables(name: 'pwsh.exe' | 'powershell.exe'): string[] {
  try {
    const result = spawnSync('where.exe', [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 3_000,
    })
    if (result.status !== 0 || !result.stdout) return []

    const cwd = path.win32.resolve(process.cwd()).toLowerCase()
    return result.stdout
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .filter((candidate) => {
        const resolved = path.win32.resolve(candidate).toLowerCase()
        const dir = path.win32.dirname(resolved)
        return dir !== cwd && !dir.startsWith(`${cwd}\\`)
      })
  } catch {
    return []
  }
}

function getKnownPowerShellCandidates(): Array<{ kind: WindowsPowerShellResolution['kind']; cmd: string }> {
  const programFilesRoots = [process.env.ProgramW6432, process.env.ProgramFiles, 'C:\\Program Files'].filter(
    (root): root is string => Boolean(root)
  )
  const pwshCandidates = [...new Set(programFilesRoots)].map((root) =>
    path.win32.join(root, 'PowerShell', '7', 'pwsh.exe')
  )
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return [
    ...pwshCandidates.map((cmd) => ({ kind: 'pwsh' as const, cmd })),
    {
      kind: 'windows-powershell' as const,
      cmd: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    },
  ]
}

/** Resolve PowerShell 7 first, then the Windows PowerShell version bundled with Windows. */
export function resolveWindowsPowerShell(): WindowsPowerShellResolution | null {
  const cacheKey = getWindowsPowerShellCacheKey()
  if (cachedWindowsPowerShell?.cacheKey === cacheKey) return cachedWindowsPowerShell.resolution

  const override = process.env.CHATBOX_POWERSHELL_PATH
  if (override && commandSucceeds(override, POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
    const kind = path.win32.basename(override).toLowerCase() === 'pwsh.exe' ? 'pwsh' : 'windows-powershell'
    return cacheWindowsPowerShell(cacheKey, { kind, cmd: override, args: [...POWERSHELL_STDIN_ARGS] })
  }

  const knownCandidates = getKnownPowerShellCandidates()
  for (const candidate of knownCandidates.filter(({ kind }) => kind === 'pwsh')) {
    if (commandSucceeds(candidate.cmd, POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
      return cacheWindowsPowerShell(cacheKey, { ...candidate, args: [...POWERSHELL_STDIN_ARGS] })
    }
  }

  const pwshOnPath = findWindowsExecutables('pwsh.exe')[0]
  if (pwshOnPath && commandSucceeds(pwshOnPath, POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
    return cacheWindowsPowerShell(cacheKey, { kind: 'pwsh', cmd: pwshOnPath, args: [...POWERSHELL_STDIN_ARGS] })
  }
  if (commandSucceeds('pwsh.exe', POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
    return cacheWindowsPowerShell(cacheKey, { kind: 'pwsh', cmd: 'pwsh.exe', args: [...POWERSHELL_STDIN_ARGS] })
  }

  for (const candidate of knownCandidates.filter(({ kind }) => kind === 'windows-powershell')) {
    if (commandSucceeds(candidate.cmd, POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
      return cacheWindowsPowerShell(cacheKey, { ...candidate, args: [...POWERSHELL_STDIN_ARGS] })
    }
  }

  const windowsPowerShellOnPath = findWindowsExecutables('powershell.exe')[0]
  if (
    windowsPowerShellOnPath &&
    commandSucceeds(windowsPowerShellOnPath, POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)
  ) {
    return cacheWindowsPowerShell(cacheKey, {
      kind: 'windows-powershell',
      cmd: windowsPowerShellOnPath,
      args: [...POWERSHELL_STDIN_ARGS],
    })
  }
  if (commandSucceeds('powershell.exe', POWERSHELL_PROBE_ARGS, POWERSHELL_PROBE_TIMEOUT)) {
    return cacheWindowsPowerShell(cacheKey, {
      kind: 'windows-powershell',
      cmd: 'powershell.exe',
      args: [...POWERSHELL_STDIN_ARGS],
    })
  }

  return null
}
