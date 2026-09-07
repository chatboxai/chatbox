import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { shellQuote } from '../../shared/utils/shell'
import { buildPowerShellStdinScript, buildSandboxStdinScript, stripCodesignNoise } from './exec-script'

describe('stripCodesignNoise', () => {
  test('removes the Electron code-signing warning while preserving user stderr', () => {
    const stderr = [
      '[0525/114014.700946:ERROR:codesign_util.cc(109)] SecCodeCheckValidity: Error Domain=NSOSStatusErrorDomain Code=-2147409622 "(null)" (-2147409622)',
      'real user stderr',
      '',
    ].join('\n')
    expect(stripCodesignNoise(stderr)).toBe('real user stderr\n')
  })

  test('is a no-op when the pattern is absent', () => {
    expect(stripCodesignNoise('just some output\n')).toBe('just some output\n')
    expect(stripCodesignNoise('')).toBe('')
  })
})

describe('buildSandboxStdinScript', () => {
  test('node language passes the code through unchanged', () => {
    const code = "console.log('hi')"
    expect(buildSandboxStdinScript(code, 'node', '/path/to/electron', true)).toBe(code)
  })

  test('powershell language configures UTF-8 before executing the code from stdin', () => {
    const code = "[Console]::Out.WriteLine('hello from PowerShell')"
    const script = buildSandboxStdinScript(code, 'powershell', 'unused', false, true)
    expect(script).toContain('[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)')
    expect(script).toContain('[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)')
    expect(script.endsWith(`${code}\n`)).toBe(true)
  })

  test('bash language prepends a node() shim and executes the parsed program with stdin closed', () => {
    const nodePath = '/Applications/My App/electron'
    const script = buildSandboxStdinScript('node -e "1"', 'bash', nodePath, true)
    expect(script).toBe(
      `node() { ELECTRON_RUN_AS_NODE=1 ${shellQuote(nodePath)} "$@"; }\nset -o pipefail\n{\n:\nnode -e "1"\n\n} </dev/null`
    )
    // The bundled path must be shell-quoted so paths with spaces still resolve.
    expect(script).toContain(shellQuote(nodePath))
    // No base64 anywhere in the produced program.
    expect(script).not.toContain('base64')
  })

  test('does not shadow the shell node command when the shim is disabled', () => {
    const script = buildSandboxStdinScript('node -e "1"', 'bash', 'C:\\Program Files\\Chatbox.exe', false)
    expect(script).not.toContain('node()')
    expect(script).not.toContain('Chatbox.exe')
    expect(script).toBe('set -o pipefail\n{\n:\nnode -e "1"\n\n} </dev/null')
  })

  test.skipIf(process.platform === 'win32')('converts native Windows paths passed to the Bash cd builtin', () => {
    for (const pathConverter of ['cygpath', 'wslpath']) {
      const code = [
        `${pathConverter}() { printf '%s\\n' "$PWD"; }`,
        'cd "C:\\Users\\themez\\workspace\\chatbox-pro"',
        "printf 'windows-cd-ok\\n'",
      ].join('\n')
      const script = buildSandboxStdinScript(code, 'bash', process.execPath, false, true)
      const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('windows-cd-ok\n')
      expect(result.stderr).toBe('')
    }
  })

  test.skipIf(process.platform === 'win32')('empty and comment-only bash programs remain valid', () => {
    for (const code of ['', '# no commands']) {
      const script = buildSandboxStdinScript(code, 'bash', process.execPath, false)
      const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    }
  })

  test.skipIf(process.platform === 'win32')('preserves the final bash command exit status', () => {
    const script = buildSandboxStdinScript('exit 7', 'bash', process.execPath, false)
    const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })
    expect(result.status).toBe(7)
  })

  test.skipIf(process.platform === 'win32')('preserves a failed pipeline command exit status', () => {
    const script = buildSandboxStdinScript('bash -c "exit 7" | tail -1', 'bash', process.execPath, false)
    const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })
    expect(result.status).toBe(7)
  })

  test.skipIf(process.platform === 'win32')('preserves a trailing backslash at the end of the program', () => {
    const script = buildSandboxStdinScript('printf x \\', 'bash', process.execPath, false)
    const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('x')
    expect(result.stderr).toBe('')
  })

  test.skipIf(process.platform === 'win32')('stdin-consuming commands cannot eat later bash source', () => {
    const script = buildSandboxStdinScript("cat\nprintf 'after\\n'", 'bash', process.execPath, false)
    const result = spawnSync('bash', [], { input: script, encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('after\n')
    expect(result.stderr).toBe('')
  })
})

describe('buildPowerShellStdinScript', () => {
  test('uses real newline separators and terminates the complete stdin payload', () => {
    const code = "Write-Output 'PS_STDOUT_PROBE'"
    const script = buildPowerShellStdinScript(code)

    expect(script).toBe(
      [
        '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
        '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
        '$OutputEncoding = [Console]::OutputEncoding',
        code,
        '',
      ].join('\n')
    )
    expect(script.charCodeAt(script.length - 1)).toBe(10)
  })

  test('can expose the bundled Electron runtime as node', () => {
    const script = buildPowerShellStdinScript('node script.mjs', "C:\\Program Files\\Chatbox's\\Chatbox.exe")

    expect(script).toContain('function node {')
    expect(script).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
    expect(script).toContain("& 'C:\\Program Files\\Chatbox''s\\Chatbox.exe' @args")
    expect(script).toContain('$chatboxNodeExitCode = $LASTEXITCODE')
    expect(script).toContain('$global:LASTEXITCODE = $chatboxNodeExitCode')
    expect(script).toContain('}\n\nnode script.mjs\n')
    expect(script.endsWith('node script.mjs\n')).toBe(true)
  })
})
