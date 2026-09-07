import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetWindowsPowerShellResolutionCache } from '../windows-powershell'

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../util', () => ({
  getLogger: () => logger,
}))

import { executeUserExecCommand } from './user-exec-runner'

describe.skipIf(process.platform !== 'win32')('user_exec on native Windows', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'chatbox user exec 中文-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    resetWindowsPowerShellResolutionCache()
    vi.clearAllMocks()
  })

  test('captures a single PowerShell stdout statement without the bundled node shim', async () => {
    await expect(
      executeUserExecCommand({ command: "Write-Output 'PS_STDOUT_PROBE'", cwd: workDir, injectBundledNode: false })
    ).resolves.toMatchObject({
      success: true,
      stdout: expect.stringMatching(/^PS_STDOUT_PROBE\r?\n$/),
      stderr: '',
      exitCode: 0,
    })
  })

  test('captures PowerShell stdout after injecting the multiline bundled node shim', async () => {
    await expect(
      executeUserExecCommand({
        command: "Write-Output 'PS_SHIM_STDOUT_PROBE'",
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({
      success: true,
      stdout: expect.stringMatching(/^PS_SHIM_STDOUT_PROBE\r?\n$/),
      stderr: '',
      exitCode: 0,
    })
  })

  test('executes a multiline PowerShell function after the injected node shim', async () => {
    const markerPath = path.join(workDir, 'shim-marker.txt')
    const result = await executeUserExecCommand({
      command: [
        'function Invoke-Probe {',
        "  [IO.File]::WriteAllText('shim-marker.txt', 'created', [Text.UTF8Encoding]::new($false))",
        "  Write-Output 'PS_MULTILINE_PROBE'",
        '}',
        'Invoke-Probe',
      ].join('\n'),
      cwd: workDir,
      injectBundledNode: true,
    })

    expect(result).toMatchObject({ success: true, stderr: '', exitCode: 0 })
    expect(result.stdout).toMatch(/^PS_MULTILINE_PROBE\r?\n$/)
    expect(readFileSync(markerPath, 'utf8')).toBe('created')
  })

  test('runs PowerShell from stdin in the requested working directory', async () => {
    const marker = 'user-exec-PowerShell-中文'
    const result = await executeUserExecCommand({
      command: [
        `$marker = '${marker}'`,
        "[IO.File]::WriteAllText('user-exec-marker.txt', $marker, [Text.UTF8Encoding]::new($false))",
        '[Console]::Out.WriteLine((Get-Location).Path)',
        '[Console]::Out.Write($marker)',
      ].join('\n'),
      cwd: workDir,
    })

    const [reportedCwd, reportedMarker] = result.stdout.trim().split(/\r?\n/, 2)
    expect(result).toMatchObject({ success: true, stderr: '', exitCode: 0 })
    expect(path.win32.normalize(realpathSync.native(reportedCwd)).toLowerCase()).toBe(
      path.win32.normalize(realpathSync.native(workDir)).toLowerCase()
    )
    expect(reportedMarker).toBe(marker)
    const outputPath = path.join(workDir, 'user-exec-marker.txt')
    expect(existsSync(outputPath)).toBe(true)
    expect(readFileSync(outputPath, 'utf8')).toBe(marker)
  })

  test('preserves a non-zero PowerShell exit code', async () => {
    await expect(executeUserExecCommand({ command: 'exit 7', cwd: workDir })).resolves.toMatchObject({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 7,
    })
  })

  test('captures stderr and preserves an explicit non-zero exit code', async () => {
    await expect(
      executeUserExecCommand({
        command: "[Console]::Error.WriteLine('PS_STDERR_PROBE'); exit 7",
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({
      success: false,
      stdout: '',
      stderr: expect.stringMatching(/^PS_STDERR_PROBE\r?\n$/),
      exitCode: 7,
    })
  })

  test('propagates the final native executable exit code', async () => {
    await expect(
      executeUserExecCommand({
        command: 'cmd.exe /d /s /c "exit /b 9"',
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({ success: false, stdout: '', stderr: '', exitCode: 9 })
  })

  test('honors a successful PowerShell statement after a failed native command', async () => {
    await expect(
      executeUserExecCommand({
        command: 'cmd.exe /d /s /c "exit /b 7"; Write-Output "recovered"',
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({
      success: true,
      stdout: expect.stringMatching(/^recovered\r?\n$/),
      stderr: '',
      exitCode: 0,
    })
  })

  test('reports a terminating PowerShell error', async () => {
    const result = await executeUserExecCommand({
      command: "throw 'PS_THROW_PROBE'",
      cwd: workDir,
      injectBundledNode: true,
    })

    expect(result).toMatchObject({ success: false, stdout: '', exitCode: 1 })
    expect(result.stderr).toContain('PS_THROW_PROBE')
  })

  test('exposes the bundled Electron runtime as node when requested', async () => {
    const electronPath = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
    expect(existsSync(electronPath)).toBe(true)
    const originalExecPath = process.execPath
    process.execPath = electronPath
    let result: Awaited<ReturnType<typeof executeUserExecCommand>>
    try {
      result = await executeUserExecCommand({
        command: 'node -e "process.stdout.write(process.execPath)"',
        cwd: workDir,
        injectBundledNode: true,
      })
    } finally {
      process.execPath = originalExecPath
    }

    expect(result).toMatchObject({ success: true, stderr: '', exitCode: 0 })
    expect(path.win32.normalize(result.stdout.trim()).toLowerCase()).toBe(
      path.win32.normalize(electronPath).toLowerCase()
    )
  })

  test('preserves a non-zero bundled node exit code', async () => {
    await expect(
      executeUserExecCommand({
        command: 'node -e "process.exit(11)"',
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({ success: false, stdout: '', stderr: '', exitCode: 11 })
  })

  test('allows a bundled node failure to be explicitly recovered', async () => {
    await expect(
      executeUserExecCommand({
        command: 'try { node -e "process.exit(11)" } catch { Write-Output "node recovered" }',
        cwd: workDir,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({
      success: true,
      stdout: expect.stringMatching(/^node recovered\r?\n$/),
      stderr: '',
      exitCode: 0,
    })
  })

  test('executes the multiline shim through the Windows PowerShell 5.1 fallback', async () => {
    const systemRoot = process.env.SystemRoot
    expect(systemRoot).toBeTruthy()
    const powershellExe = path.win32.join(
      systemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    expect(existsSync(powershellExe)).toBe(true)

    const previousOverride = process.env.CHATBOX_POWERSHELL_PATH
    process.env.CHATBOX_POWERSHELL_PATH = powershellExe
    resetWindowsPowerShellResolutionCache()
    try {
      await expect(
        executeUserExecCommand({
          command: "Write-Output 'PS51_SHIM_STDOUT_中文'",
          cwd: workDir,
          injectBundledNode: true,
        })
      ).resolves.toMatchObject({
        success: true,
        stdout: expect.stringMatching(/^PS51_SHIM_STDOUT_中文\r?\n$/),
        stderr: '',
        exitCode: 0,
      })
    } finally {
      if (previousOverride === undefined) delete process.env.CHATBOX_POWERSHELL_PATH
      else process.env.CHATBOX_POWERSHELL_PATH = previousOverride
      resetWindowsPowerShellResolutionCache()
    }
  })
})
