import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildReadFileScript } from '../../shared/utils/read-file-script'

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => {
      const os = require('node:os') as typeof import('node:os')
      const path = require('node:path') as typeof import('node:path')
      return path.join(os.tmpdir(), `chatbox-windows-tools-user-data-${process.pid}`)
    },
  },
}))
vi.mock('../util', () => ({
  getLogger: () => logger,
}))

import {
  checkAvailability,
  editFile,
  execCode,
  findFiles,
  getStatus,
  initSandbox,
  listDir,
  normalizeWindowsShellPath,
  readFile,
  resetSandbox,
  resolveWindowsBash,
  resolveWindowsPowerShell,
  searchFiles,
  writeFile,
} from './manager'
import { persistSandboxArtifact, removeSessionArtifacts } from './persist-artifact'

describe.skipIf(process.platform !== 'win32')('native Windows sandbox tools', () => {
  let sessionId: string
  let workDir: string

  beforeEach(async () => {
    sessionId = `windows-tools-${randomUUID()}`
    workDir = mkdtempSync(path.join(tmpdir(), 'chatbox Windows 中文-'))
    await expect(initSandbox(workDir, sessionId)).resolves.toEqual({
      success: true,
      acceptedWorkingDirectories: [],
    })
  })

  afterEach(async () => {
    removeSessionArtifacts(sessionId)
    await resetSandbox(sessionId)
    rmSync(workDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  test('initializes the native Windows backend without sandbox-runtime', async () => {
    await expect(checkAvailability()).resolves.toEqual({ available: true })
    expect(getStatus(sessionId)).toMatchObject({
      state: 'initialized',
      workingDirectory: workDir,
      platform: 'win32',
    })
  })

  test('executes Node code from stdin with spaces, Unicode, and the session environment', async () => {
    const marker = `Windows 中文 'quotes' $HOME`
    const code = `
const payload = {
  platform: process.platform,
  cwd: process.cwd(),
  home: process.env.HOME,
  temp: process.env.TEMP,
  marker: ${JSON.stringify(marker)},
}
console.log(JSON.stringify(payload))
`

    const result = await execCode({ code, language: 'node', sessionId })
    const payload = JSON.parse(result.stdout.trim()) as {
      platform: string
      cwd: string
      home: string
      temp: string
      marker: string
    }

    expect(result).toMatchObject({ stderr: '', exitCode: 0 })
    expect(payload).toEqual({
      platform: 'win32',
      cwd: workDir,
      home: workDir,
      temp: workDir,
      marker,
    })
  })

  test('preserves Node stderr and a non-zero exit code', async () => {
    const result = await execCode({
      code: `process.stderr.write('expected Windows stderr\\n'); process.exitCode = 7`,
      language: 'node',
      sessionId,
    })

    expect(result).toEqual({ stdout: '', stderr: 'expected Windows stderr\n', exitCode: 7 })
  })

  test('executes PowerShell from stdin in the native working directory with Unicode paths', async () => {
    expect(resolveWindowsPowerShell()).not.toBeNull()
    const marker = `powershell-native-${randomUUID()}-中文`
    const outputFile = 'PowerShell 输出.txt'
    const result = await execCode({
      code: [
        `$marker = '${marker}'`,
        `[IO.File]::WriteAllText('${outputFile}', $marker, [Text.UTF8Encoding]::new($false))`,
        '[Console]::Out.WriteLine((Get-Location).Path)',
        '[Console]::Out.Write($marker)',
      ].join('\n'),
      language: 'powershell',
      sessionId,
    })

    const [reportedCwd, reportedMarker] = result.stdout.trim().split(/\r?\n/, 2)
    expect(result).toMatchObject({ stderr: '', exitCode: 0 })
    expect(path.win32.normalize(realpathSync.native(reportedCwd)).toLowerCase()).toBe(
      path.win32.normalize(realpathSync.native(workDir)).toLowerCase()
    )
    expect(reportedMarker).toBe(marker)
    expect(readFileSync(path.join(workDir, outputFile), 'utf8')).toBe(marker)
  })

  test('preserves an explicit non-zero PowerShell exit code', async () => {
    const result = await execCode({ code: 'exit 7', language: 'powershell', sessionId })
    expect(result).toEqual({ stdout: '', stderr: '', exitCode: 7 })
  })

  test('executes Unicode stdin through the Windows PowerShell fallback', async () => {
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
    try {
      const marker = `windows-powershell-${randomUUID()}-中文`
      const result = await execCode({
        code: `[Console]::Out.Write('${marker}')`,
        language: 'powershell',
        sessionId,
      })

      expect(resolveWindowsPowerShell()).toMatchObject({ kind: 'windows-powershell', cmd: powershellExe })
      expect(result).toEqual({ stdout: marker, stderr: '', exitCode: 0 })
    } finally {
      if (previousOverride === undefined) delete process.env.CHATBOX_POWERSHELL_PATH
      else process.env.CHATBOX_POWERSHELL_PATH = previousOverride
    }
  })

  test('writes and edits nested Windows files without using Bash', async () => {
    const relativePath = path.join('nested folder', '报告 file.txt')

    await expect(writeFile(relativePath, 'alpha\nbeta\n', sessionId)).resolves.toEqual({ success: true })
    await expect(
      editFile(relativePath, { edits: [{ search: 'beta', replace: '中文 gamma' }] }, sessionId)
    ).resolves.toEqual({ success: true })

    expect(readFileSync(path.join(workDir, relativePath), 'utf8')).toBe('alpha\n中文 gamma\n')

    const outsidePath = path.resolve(workDir, '..', `outside-${randomUUID()}.txt`)
    await expect(writeFile(path.join('..', path.basename(outsidePath)), 'blocked', sessionId)).resolves.toMatchObject({
      success: false,
      error: 'Invalid path: outside sandbox',
    })
    expect(existsSync(outsidePath)).toBe(false)
  })

  test('rejects NTFS stream aliases for protected files in a granted directory', async () => {
    const grantedDir = path.join(workDir, 'granted')
    const protectedFile = path.join(grantedDir, '.env')
    mkdirSync(grantedDir)
    writeFileSync(protectedFile, 'before')

    await expect(initSandbox(workDir, sessionId, [grantedDir])).resolves.toEqual({
      success: true,
      acceptedWorkingDirectories: [path.resolve(grantedDir)],
    })
    await expect(writeFile(`${protectedFile}::$DATA`, 'after', sessionId)).resolves.toEqual({
      success: false,
      error: 'Write access denied for protected file',
    })
    expect(readFileSync(protectedFile, 'utf8')).toBe('before')
  })

  test('executes Bash through the shell available on the Windows runner', async () => {
    expect(resolveWindowsBash()).not.toBeNull()

    const result = await execCode({
      code: [`printf 'bash-ok\\n'`, 'cat', `node -e "process.stdout.write('node-from-bash\\\\n')"`].join('\n'),
      language: 'bash',
      sessionId,
    })

    expect(result).toEqual({ stdout: 'bash-ok\nnode-from-bash\n', stderr: '', exitCode: 0 })
  })

  test.each([
    {
      name: 'a final line without a trailing newline',
      filename: 'read unterminated 中文.txt',
      content: 'single line without newline',
      expectedStdout: '1\nsingle line without newline',
    },
    {
      name: 'an empty file',
      filename: 'read empty 中文.txt',
      content: '',
      expectedStdout: '0\n',
    },
    {
      name: 'a blank line',
      filename: 'read blank 中文.txt',
      content: '\n',
      expectedStdout: '1\n\n',
    },
  ])('executes the read_file Bash script for $name', async ({ filename, content, expectedStdout }) => {
    expect(resolveWindowsBash()).not.toBeNull()
    writeFileSync(path.join(workDir, filename), content, 'utf8')

    const result = await execCode({
      code: buildReadFileScript(filename, 1, 2000),
      language: 'bash',
      sessionId,
    })

    expect(result).toEqual({ stdout: expectedStdout, stderr: '', exitCode: 0 })
  })

  test('changes directory from a native Windows path in Bash', async () => {
    const targetDir = path.join(workDir, 'native path 中文')
    mkdirSync(targetDir)
    const marker = `native-windows-cd-${randomUUID()}`
    writeFileSync(path.join(targetDir, 'cwd-probe.txt'), marker)

    const result = await execCode({
      code: `cd "${targetDir}" && node -e "process.stdout.write(require('fs').readFileSync('cwd-probe.txt', 'utf8'))"`,
      language: 'bash',
      sessionId,
    })

    expect(result).toEqual({ stdout: marker, stderr: '', exitCode: 0 })
  })

  test('reads and lists files without Bash, and finds files with bundled ripgrep', async () => {
    const relativePath = path.join('folder with spaces', '报告.txt')
    await expect(writeFile(relativePath, 'hello from Windows\n', sessionId)).resolves.toEqual({ success: true })

    await expect(readFile(relativePath, sessionId, { offset: 1, limit: 1 })).resolves.toMatchObject({
      success: true,
      content: 'hello from Windows',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    })

    const listResult = await listDir(path.dirname(relativePath), sessionId)
    expect(listResult).toMatchObject({ success: true })
    expect(listResult.content).toContain('报告.txt')

    const findResult = await findFiles('.', '*.txt', sessionId)
    expect(findResult).toMatchObject({ success: true })
    expect(findResult.content).toContain('报告.txt')
  })

  test('reads large files without corrupting the structured result', async () => {
    const relativePath = 'large-output.txt'
    const line = `${'x'.repeat(900)}\t${'\\"'.repeat(40)}`
    await expect(
      writeFile(relativePath, Array.from({ length: 100 }, () => line).join('\n'), sessionId)
    ).resolves.toEqual({
      success: true,
    })

    const result = await readFile(relativePath, sessionId, { offset: 1, limit: 100 })

    expect(result).toMatchObject({ success: true, startLine: 1, totalLines: 100 })
    expect(result.endLine).toBeGreaterThan(0)
    expect(result.endLine).toBeLessThan(100)
    expect(Buffer.byteLength(result.content ?? '', 'utf8')).toBeLessThan(50 * 1024)
  })

  test('persists a relative download artifact without Bash path resolution', async () => {
    await expect(writeFile('dashboard.html', '<html>Windows</html>', sessionId)).resolves.toEqual({ success: true })

    const result = await persistSandboxArtifact('dashboard.html', sessionId)

    expect(result.success).toBe(true)
    expect(result.artifactPath).toBeTruthy()
    if (result.artifactPath) {
      expect(readFileSync(result.artifactPath, 'utf8')).toBe('<html>Windows</html>')
    }
  })

  test('searches files with the bundled native Windows ripgrep binary', async () => {
    await expect(
      writeFile(path.join('src', 'alpha.ts'), `const first = true\nconst needle = '中文'\n`, sessionId)
    ).resolves.toEqual({ success: true })
    await expect(writeFile(path.join('src', 'ignored.md'), 'needle\n', sessionId)).resolves.toEqual({ success: true })

    const result = await searchFiles('needle', '.', { include: '*.ts' }, sessionId)

    expect(result).toMatchObject({ success: true })
    expect(result.content).toContain("src/alpha.ts:2:const needle = '中文'")
    expect(result.content).not.toContain('ignored.md')
  })

  test('normalizes Git Bash, WSL, and Cygwin drive paths on a real Windows host', () => {
    expect(normalizeWindowsShellPath('/c/Users/alice/file.txt')).toBe('C:\\Users\\alice\\file.txt')
    expect(normalizeWindowsShellPath('/mnt/d/data/report.csv')).toBe('D:\\data\\report.csv')
    expect(normalizeWindowsShellPath('/cygdrive/e/tmp/out.txt')).toBe('E:\\tmp\\out.txt')
  })
})
