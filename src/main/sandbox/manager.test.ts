import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SANDBOX_EXEC_ERROR_CODES } from '../../shared/sandbox-provider'

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../util', () => ({
  getLogger: () => logger,
}))
vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }))

import { spawn, spawnSync } from 'node:child_process'
import {
  editFile,
  execCode,
  initSandbox,
  killRunningCommand,
  normalizeWindowsShellPath,
  resetSandbox,
  resetWindowsPowerShellResolutionCache,
  resolveWindowsBash,
  resolveWindowsPowerShell,
  shellEscape,
  validateWritePath,
  writeFile,
} from './manager'

const originalPlatform = process.platform
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('shellEscape', () => {
  test('wraps a simple string in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'")
  })

  test('escapes embedded single quotes', () => {
    const result = shellEscape("it's")
    // The standard shell-quote approach: end current quote, add escaped quote, restart quote
    expect(result).toBe("'it'\\''s'")
  })

  test('handles empty string', () => {
    expect(shellEscape('')).toBe("''")
  })

  test('handles shell special characters without interpreting them', () => {
    const specials = ['$HOME', '`whoami`', 'a;b', 'a|b', 'a&b', 'a>b', 'a<b']
    for (const s of specials) {
      const result = shellEscape(s)
      // Single-quoted strings prevent shell interpretation, so the value should be wrapped
      expect(result).toBe(`'${s}'`)
    }
  })

  test('handles strings with newlines', () => {
    const result = shellEscape('line1\nline2')
    expect(result).toBe("'line1\nline2'")
  })

  test('handles null bytes without crashing', () => {
    expect(() => shellEscape('a\0b')).not.toThrow()
    const result = shellEscape('a\0b')
    expect(typeof result).toBe('string')
  })

  test('handles string that is only single quotes', () => {
    const result = shellEscape("'''")
    // Each ' becomes '\'' so: '' + \' + '' + \' + '' + \' + ''
    expect(result).toBe("''\\'''\\'''\\'''")
  })

  test('handles spaces and tabs', () => {
    expect(shellEscape('hello world')).toBe("'hello world'")
    expect(shellEscape('hello\tworld')).toBe("'hello\tworld'")
  })
})

describe('resolveWindowsBash', () => {
  const mockShellAvailability = ({
    bash = false,
    wslStatus = 1,
    wslDistros = '',
  }: {
    bash?: boolean
    wslStatus?: number
    wslDistros?: string
  }) => {
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'bash' && args[0] === '--version') return { status: bash ? 0 : 1 }
      if (cmd === 'where.exe') return { status: 1, stdout: '' }
      if (cmd === 'wsl' && args[0] === '--list') {
        return {
          status: wslStatus,
          stdout: Buffer.from(`\uFEFF${wslDistros}`, 'utf16le'),
        }
      }
      return { status: 1 }
    })
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('uses an explicit Git Bash override before auto-discovery', () => {
    const customPath = 'D:\\PortableGit\\bin\\bash.exe'
    vi.stubEnv('CHATBOX_GIT_BASH_PATH', customPath)
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => ({
      status: cmd === customPath && args[0] === '--version' ? 0 : 1,
      stdout: '',
    }))

    expect(resolveWindowsBash()).toEqual({ kind: 'git-bash', cmd: customPath, args: [] })
  })

  test('prefers a known Git Bash installation over bash on PATH and WSL', () => {
    vi.stubEnv('ProgramFiles', 'C:\\Program Files')
    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === gitBashPath && args[0] === '--version') return { status: 0 }
      if (cmd === 'bash' && args[0] === '--version') return { status: 0 }
      return { status: 1, stdout: '' }
    })

    expect(resolveWindowsBash()).toEqual({ kind: 'git-bash', cmd: gitBashPath, args: [] })
  })

  test('derives Git Bash from a git.exe discovered by where.exe', () => {
    const gitPath = 'D:\\PortableGit\\cmd\\git.exe'
    const bashPath = 'D:\\PortableGit\\bin\\bash.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'git.exe') return { status: 0, stdout: `${gitPath}\r\n` }
      if (cmd === bashPath && args[0] === '--version') return { status: 0 }
      return { status: 1, stdout: '' }
    })

    expect(resolveWindowsBash()).toEqual({ kind: 'git-bash', cmd: bashPath, args: [] })
  })

  test('classifies a non-Git bash.exe discovered on PATH separately', () => {
    const bashPath = 'C:\\msys64\\usr\\bin\\bash.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'git.exe') return { status: 1, stdout: '' }
      if (cmd === 'where.exe' && args[0] === 'bash.exe') return { status: 0, stdout: `${bashPath}\r\n` }
      if (cmd === bashPath && args[0] === '--version') return { status: 0 }
      return { status: 1, stdout: '' }
    })

    expect(resolveWindowsBash()).toEqual({ kind: 'path-bash', cmd: bashPath, args: [] })
  })

  test('prefers bash on PATH', () => {
    mockShellAvailability({ bash: true, wslStatus: 0, wslDistros: 'Ubuntu\n' })
    expect(resolveWindowsBash()).toEqual({ kind: 'path-bash', cmd: 'bash', args: [] })
  })

  test('falls back to wsl bash when bash is absent and a distribution is installed', () => {
    mockShellAvailability({ wslStatus: 0, wslDistros: 'Ubuntu\n' })
    expect(resolveWindowsBash()).toEqual({ kind: 'wsl', cmd: 'wsl', args: ['bash'] })
  })

  test('returns null when wsl exists without an installed distribution', () => {
    mockShellAvailability({ wslStatus: 0, wslDistros: '' })
    expect(resolveWindowsBash()).toBeNull()
  })

  test('returns null when neither bash nor wsl is available', () => {
    mockShellAvailability({})
    expect(resolveWindowsBash()).toBeNull()
  })
})

describe('resolveWindowsPowerShell', () => {
  const stdinArgs = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    expect.stringMatching(
      /\[Console\]::InputEncoding.+\[Console\]::In\.ReadToEnd\(\).+\[ScriptBlock\]::Create.+exit \$chatboxExitCode/s
    ),
  ]

  afterEach(() => {
    resetWindowsPowerShellResolutionCache()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('uses an explicit PowerShell override before auto-discovery', () => {
    const customPath = 'D:\\Tools\\pwsh.exe'
    vi.stubEnv('CHATBOX_POWERSHELL_PATH', customPath)
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => ({
      status: cmd === customPath ? 0 : 1,
    }))

    expect(resolveWindowsPowerShell()).toEqual({ kind: 'pwsh', cmd: customPath, args: stdinArgs })
  })

  test('allows a slow cold start and caches the successful resolution', () => {
    const customPath = 'D:\\Tools\\pwsh.exe'
    vi.stubEnv('CHATBOX_POWERSHELL_PATH', customPath)
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], options: { timeout?: number }) => ({
        status: (options.timeout ?? 0) >= 10_000 ? 0 : null,
      })
    )

    const expected = { kind: 'pwsh', cmd: customPath, args: stdinArgs }
    expect(resolveWindowsPowerShell()).toEqual(expected)
    expect(resolveWindowsPowerShell()).toEqual(expected)
    expect(spawnSync).toHaveBeenCalledTimes(1)
  })

  test('prefers a known PowerShell 7 installation over Windows PowerShell', () => {
    vi.stubEnv('ProgramW6432', 'C:\\Program Files')
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const windowsPowerShellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => ({
      status: cmd === pwshPath || cmd === windowsPowerShellPath ? 0 : 1,
      stdout: '',
    }))

    expect(resolveWindowsPowerShell()).toEqual({ kind: 'pwsh', cmd: pwshPath, args: stdinArgs })
  })

  test('discovers PowerShell 7 through where.exe', () => {
    const pwshPath = 'D:\\PowerShell\\pwsh.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'pwsh.exe') return { status: 0, stdout: `${pwshPath}\r\n` }
      if (cmd === pwshPath) return { status: 0, stdout: '' }
      return { status: 1, stdout: '' }
    })

    expect(resolveWindowsPowerShell()).toEqual({ kind: 'pwsh', cmd: pwshPath, args: stdinArgs })
  })

  test('falls back to the Windows PowerShell bundled with Windows', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    const windowsPowerShellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => ({
      status: cmd === windowsPowerShellPath ? 0 : 1,
      stdout: '',
    }))

    expect(resolveWindowsPowerShell()).toEqual({
      kind: 'windows-powershell',
      cmd: windowsPowerShellPath,
      args: stdinArgs,
    })
  })

  test('returns null when neither PowerShell implementation is available', () => {
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1, stdout: '' })
    expect(resolveWindowsPowerShell()).toBeNull()
  })
})

describe('execCode on Windows without shell runtimes', () => {
  afterEach(() => {
    setPlatform(originalPlatform)
    vi.clearAllMocks()
  })

  test('returns a stable error code for Bash while native file tools remain independent', async () => {
    setPlatform('win32')
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) =>
      cmd === 'wsl' ? { status: 0, stdout: Buffer.alloc(0) } : { status: 1 }
    )
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-no-bash-'))
    const sessionId = 'no-bash-session'
    try {
      await initSandbox(workDir, sessionId)
      const result = await execCode({
        code: 'echo hello',
        language: 'bash',
        sessionId,
        toolCallId: 'tool-call-1',
      })

      expect(result).toEqual({
        stdout: '',
        stderr: 'bash is not available on this Windows host. Install Git Bash or enable WSL, or use node.',
        exitCode: 127,
        errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE,
      })
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('"toolCallId":"tool-call-1"'))
    } finally {
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('returns a stable error when PowerShell cannot be resolved', async () => {
    setPlatform('win32')
    ;(spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1, stdout: '' })
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-no-powershell-'))
    const sessionId = 'no-powershell-session'
    try {
      await initSandbox(workDir, sessionId)
      const result = await execCode({ code: "Write-Output 'hello'", language: 'powershell', sessionId })

      expect(result).toEqual({
        stdout: '',
        stderr:
          'PowerShell is not available on this Windows host. Install PowerShell 7 or enable Windows PowerShell, or use Node.js.',
        exitCode: 127,
        errorCode: SANDBOX_EXEC_ERROR_CODES.POWERSHELL_NOT_AVAILABLE,
      })
    } finally {
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('keeps HOME and temp redirected to the session directory (native Windows has no OS sandbox)', async () => {
    setPlatform('win32')
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-win-env-'))
    const profileDir = mkdtempSync(path.join(tmpdir(), 'chatbox-win-profile-'))
    const sessionId = 'windows-env-session'
    const previousUserProfile = process.env.USERPROFILE
    const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL
    const children: EventEmitter[] = []
    ;(spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
        killed: false,
        pid: 300 + children.length,
      })
      children.push(child)
      return child
    })
    const runAndCaptureEnv = async () => {
      const execution = execCode({ code: 'console.log("hi")', language: 'node', sessionId })
      children[children.length - 1].emit('close', 0)
      await expect(execution).resolves.toMatchObject({ exitCode: 0 })
      const calls = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls
      return (calls[calls.length - 1][2] as { env: NodeJS.ProcessEnv }).env
    }

    try {
      await initSandbox(workDir, sessionId)
      process.env.USERPROFILE = profileDir
      delete process.env.GIT_CONFIG_GLOBAL

      writeFileSync(path.join(profileDir, '.gitconfig'), '[user]\n\tname = Real Name\n')
      const env = await runAndCaptureEnv()
      expect(env).toMatchObject({
        HOME: workDir,
        TMPDIR: workDir,
        TMP: workDir,
        TEMP: workDir,
        XDG_CACHE_HOME: path.join(workDir, '.cache'),
        npm_config_cache: path.join(workDir, '.cache', 'npm'),
        GIT_CONFIG_GLOBAL: path.join(profileDir, '.gitconfig'),
      })

      // XDG fallback when ~/.gitconfig is absent.
      rmSync(path.join(profileDir, '.gitconfig'))
      const xdgConfig = path.join(profileDir, '.config', 'git', 'config')
      mkdirSync(path.dirname(xdgConfig), { recursive: true })
      writeFileSync(xdgConfig, '[user]\n\tname = Real Name\n')
      expect((await runAndCaptureEnv()).GIT_CONFIG_GLOBAL).toBe(xdgConfig)

      // No global config in the real profile: leave git untouched.
      rmSync(path.join(profileDir, '.config'), { recursive: true })
      expect((await runAndCaptureEnv()).GIT_CONFIG_GLOBAL).toBeUndefined()
    } finally {
      if (previousUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = previousUserProfile
      if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  test('logs only one finish record when spawn emits error and close', async () => {
    setPlatform('win32')
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-spawn-error-'))
    const sessionId = 'spawn-error-session'
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
      killed: false,
      pid: 123,
    })
    ;(spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child)

    try {
      await initSandbox(workDir, sessionId)
      const execution = execCode({ code: 'console.log("hello")', language: 'node', sessionId })
      child.emit('error', new Error('spawn failed'))
      child.emit('close', -2)

      await expect(execution).rejects.toThrow('spawn failed')
      const finishLogs = logger.warn.mock.calls.filter(
        ([message]) => typeof message === 'string' && message.startsWith('agent_operation finish ')
      )
      expect(finishLogs).toHaveLength(1)
    } finally {
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('kills the sandbox command matching the requested tool call', async () => {
    setPlatform('win32')
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-parallel-kill-'))
    const sessionId = 'parallel-kill-session'
    const createChild = (pid: number) =>
      Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        killed: false,
        pid,
      })
    const firstChild = createChild(101)
    const secondChild = createChild(202)
    const taskkillChild = new EventEmitter()
    const pendingChildren = [firstChild, secondChild]
    ;(spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation((command: string) => {
      if (command === 'taskkill') return taskkillChild
      const child = pendingChildren.shift()
      if (!child) throw new Error('Unexpected sandbox command spawn')
      return child
    })

    try {
      await initSandbox(workDir, sessionId)
      const firstExecution = execCode({
        code: 'setInterval(() => {}, 1000)',
        language: 'node',
        sessionId,
        toolCallId: 'tool-1',
      })
      const secondExecution = execCode({
        code: 'setInterval(() => {}, 1000)',
        language: 'node',
        sessionId,
        toolCallId: 'tool-2',
      })

      expect(killRunningCommand(sessionId, 'tool-1')).toEqual({ killed: true })
      expect(spawn).toHaveBeenCalledWith('taskkill', ['/PID', '101', '/T', '/F'], { stdio: 'ignore' })
      expect(spawn).not.toHaveBeenCalledWith('taskkill', ['/PID', '202', '/T', '/F'], { stdio: 'ignore' })

      firstChild.emit('close', 143)
      secondChild.emit('close', 0)
      await Promise.all([firstExecution, secondExecution])
    } finally {
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('kills a sandbox command that registers after cancellation', async () => {
    setPlatform('win32')
    const workDir = mkdtempSync(path.join(tmpdir(), 'chatbox-early-kill-'))
    const sessionId = 'early-kill-session'
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      killed: false,
      pid: 303,
    })
    const taskkillChild = new EventEmitter()
    ;(spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation((command: string) =>
      command === 'taskkill' ? taskkillChild : child
    )

    try {
      await initSandbox(workDir, sessionId)
      expect(killRunningCommand(sessionId, 'tool-before-spawn')).toEqual({ killed: false })

      const execution = execCode({
        code: 'setInterval(() => {}, 1000)',
        language: 'node',
        sessionId,
        toolCallId: 'tool-before-spawn',
      })

      expect(spawn).toHaveBeenCalledWith('taskkill', ['/PID', '303', '/T', '/F'], { stdio: 'ignore' })
      child.emit('close', 143)
      await execution
    } finally {
      await resetSandbox(sessionId)
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})

describe('normalizeWindowsShellPath', () => {
  afterEach(() => setPlatform(originalPlatform))

  test('converts Git Bash, WSL and Cygwin paths to native Windows form on win32', () => {
    setPlatform('win32')
    expect(normalizeWindowsShellPath('/c/Users/a/out.txt')).toBe('C:\\Users\\a\\out.txt')
    expect(normalizeWindowsShellPath('/mnt/c/data/x.csv')).toBe('C:\\data\\x.csv')
    expect(normalizeWindowsShellPath('/cygdrive/d/y')).toBe('D:\\y')
    expect(normalizeWindowsShellPath('/c')).toBe('C:\\')
  })

  test('leaves already-Windows and non-drive POSIX paths unchanged on win32', () => {
    setPlatform('win32')
    expect(normalizeWindowsShellPath('C:\\foo\\bar')).toBe('C:\\foo\\bar')
    expect(normalizeWindowsShellPath('/home/alice/x')).toBe('/home/alice/x')
  })

  test('is a no-op on POSIX platforms', () => {
    setPlatform('linux')
    expect(normalizeWindowsShellPath('/c/x')).toBe('/c/x')
  })
})

describe('validateWritePath with user-granted directories', () => {
  test('accepts a granted directory while rejecting sibling and symlink escapes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-granted-path-'))
    const workDir = path.join(root, 'sandbox')
    const grantedDir = path.join(root, 'granted')
    const outsideDir = path.join(root, 'outside')
    mkdirSync(workDir)
    mkdirSync(grantedDir)
    mkdirSync(outsideDir)
    symlinkSync(outsideDir, path.join(grantedDir, 'escape'), 'dir')

    try {
      await expect(
        validateWritePath(path.join(grantedDir, 'nested', 'out.txt'), workDir, [grantedDir])
      ).resolves.toEqual({ valid: true })
      await expect(validateWritePath(path.join(outsideDir, 'out.txt'), workDir, [grantedDir])).resolves.toEqual({
        valid: false,
        error: 'Invalid path: outside sandbox or granted working directories',
      })
      await expect(
        validateWritePath(path.join(grantedDir, 'escape', 'out.txt'), workDir, [grantedDir])
      ).resolves.toEqual({
        valid: false,
        error: 'Invalid path: outside sandbox or granted working directories',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('native Windows writes to user-granted directories', () => {
  afterEach(() => setPlatform(originalPlatform))

  test('preserves the sandbox-only error when no user directory grant exists', async () => {
    setPlatform('win32')
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-sandbox-only-'))
    const workDir = path.join(root, 'sandbox')
    const outsideFile = path.join(root, 'outside.txt')
    const sessionId = 'windows-sandbox-only-session'
    mkdirSync(workDir)

    try {
      await expect(initSandbox(workDir, sessionId)).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [],
      })
      await expect(writeFile(outsideFile, 'blocked', sessionId)).resolves.toEqual({
        success: false,
        error: 'Invalid path: outside sandbox',
      })
      expect(existsSync(outsideFile)).toBe(false)
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('persists the grant on the session and applies it to write/edit operations', async () => {
    setPlatform('win32')
    // The production guard intentionally rejects /var and /private; use the checkout as a
    // representative user project location rather than the OS temp root for this grant test.
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-granted-'))
    const workDir = path.join(root, 'sandbox')
    const grantedDir = path.join(root, 'granted')
    const outsideDir = path.join(root, 'outside')
    const sessionId = 'windows-granted-session'
    mkdirSync(workDir)
    mkdirSync(grantedDir)
    mkdirSync(outsideDir)

    try {
      await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [path.resolve(grantedDir)],
      })
      const grantedFile = path.join(grantedDir, 'nested', 'out.txt')
      await expect(writeFile(grantedFile, 'before', sessionId)).resolves.toEqual({ success: true })
      await expect(
        editFile(grantedFile, { edits: [{ search: 'before', replace: 'after' }] }, sessionId)
      ).resolves.toEqual({ success: true })
      expect(readFileSync(grantedFile, 'utf8')).toBe('after')

      await expect(writeFile(path.join(outsideDir, 'out.txt'), 'blocked', sessionId)).resolves.toEqual({
        success: false,
        error: 'Invalid path: outside sandbox or granted working directories',
      })
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('does not report missing paths or regular files as accepted directories', async () => {
    setPlatform('win32')
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-unavailable-'))
    const workDir = path.join(root, 'sandbox')
    const missingDir = path.join(root, 'missing')
    const regularFile = path.join(root, 'file.txt')
    const sessionId = 'windows-unavailable-session'
    mkdirSync(workDir)
    writeFileSync(regularFile, 'not a directory')

    try {
      await expect(initSandbox(workDir, sessionId, [missingDir, regularFile])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [],
      })
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects protected files inside a granted directory', async () => {
    setPlatform('win32')
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-protected-'))
    const workDir = path.join(root, 'sandbox')
    const grantedDir = path.join(root, 'granted')
    const nestedDir = path.join(grantedDir, 'nested')
    const protectedDir = path.join(grantedDir, '.env')
    const protectedAlias = path.join(grantedDir, 'config')
    const sessionId = 'windows-protected-session'
    mkdirSync(workDir)
    mkdirSync(nestedDir, { recursive: true })
    mkdirSync(protectedDir)
    symlinkSync(protectedDir, protectedAlias, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(path.join(nestedDir, '.ENV.LOCAL'), 'before')

    try {
      await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [path.resolve(grantedDir)],
      })
      await expect(writeFile(path.join(grantedDir, '.env'), 'secret', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(writeFile(path.join(grantedDir, '.ENV. '), 'secret', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(writeFile(path.join(nestedDir, '.ENV.LOCAL::$DATA'), 'secret', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(writeFile(path.join(grantedDir, '.env.production:payload'), 'secret', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(writeFile(path.join(protectedAlias, 'secret.txt'), 'secret', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(
        editFile(path.join(nestedDir, '.ENV.LOCAL'), { search: 'before', replace: 'after' }, sessionId)
      ).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      expect(readFileSync(path.join(nestedDir, '.ENV.LOCAL'), 'utf8')).toBe('before')
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects top-level git metadata writes but keeps other .git paths writable', async () => {
    setPlatform('win32')
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-git-meta-'))
    const workDir = path.join(root, 'sandbox')
    const grantedDir = path.join(root, 'granted')
    const sessionId = 'windows-git-meta-session'
    mkdirSync(workDir)
    mkdirSync(path.join(grantedDir, '.git', 'hooks'), { recursive: true })
    mkdirSync(path.join(grantedDir, 'vendor', 'repo', '.git'), { recursive: true })

    try {
      await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [path.resolve(grantedDir)],
      })
      // Host-escape vectors at the granted root stay read-only…
      await expect(writeFile(path.join(grantedDir, '.git', 'config'), '[probe]', sessionId)).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      await expect(
        writeFile(path.join(grantedDir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh', sessionId)
      ).resolves.toEqual({
        success: false,
        error: 'Write access denied for protected file',
      })
      // …while ordinary repo metadata and nested repos stay writable (commit/clone flows).
      await expect(writeFile(path.join(grantedDir, '.git', 'COMMIT_EDITMSG'), 'msg', sessionId)).resolves.toEqual({
        success: true,
      })
      await expect(
        writeFile(path.join(grantedDir, 'vendor', 'repo', '.git', 'config'), '[core]', sessionId)
      ).resolves.toEqual({ success: true })
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects writes after the granted root is replaced with a symlink or junction', async () => {
    setPlatform('win32')
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-windows-retargeted-'))
    const workDir = path.join(root, 'sandbox')
    const grantedDir = path.join(root, 'granted')
    const originalGrantedDir = path.join(root, 'granted-original')
    const outsideDir = path.join(root, 'outside')
    const outsideFile = path.join(outsideDir, 'out.txt')
    const sessionId = 'windows-retargeted-session'
    mkdirSync(workDir)
    mkdirSync(grantedDir)
    mkdirSync(outsideDir)

    try {
      await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [path.resolve(grantedDir)],
      })
      renameSync(grantedDir, originalGrantedDir)
      symlinkSync(outsideDir, grantedDir, process.platform === 'win32' ? 'junction' : 'dir')

      // Renderer providers can be recreated between messages. Repeating initialization with
      // the same requested paths must retain the original canonical target instead of granting
      // the replacement junction.
      await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
        success: true,
        acceptedWorkingDirectories: [path.resolve(grantedDir)],
      })

      await expect(writeFile(path.join(grantedDir, 'out.txt'), 'escaped', sessionId)).resolves.toEqual({
        success: false,
        error: 'Invalid path: outside sandbox or granted working directories',
      })
      expect(existsSync(outsideFile)).toBe(false)
    } finally {
      await resetSandbox(sessionId)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
