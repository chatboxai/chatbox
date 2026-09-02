import type { SandboxExecLanguage } from '../../shared/sandbox-provider'
import { shellQuote } from '../../shared/utils/shell'

// Pure helpers for building the stdin program and cleaning stderr for sandbox code execution.

const POWERSHELL_UTF8_PREAMBLE = [
  '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
].join('\n')
// Kept free of any Electron/Node-runtime imports so they can be unit-tested in isolation.

const CODESIGN_NOISE_RE = /ERROR:codesign_util\.cc\(109\).*SecCodeCheckValidity/

const WINDOWS_CD_SHIM = `cd() {
  if [ "$#" -eq 1 ]; then
    case "$1" in
      [A-Za-z]:[\\\\/]* )
        if command -v cygpath >/dev/null 2>&1; then
          builtin cd -- "$(cygpath -u "$1")"
          return
        fi
        if command -v wslpath >/dev/null 2>&1; then
          builtin cd -- "$(wslpath -u "$1")"
          return
        fi
        ;;
    esac
  fi
  builtin cd "$@"
}
`

/**
 * Strip the macOS Electron code-signing self-check warning the bundled Electron binary can emit
 * on stderr when launched as Node. Only that specific runtime noise is removed; all other stderr
 * (including user output) is preserved verbatim. Idempotent and a no-op when the pattern is absent.
 */
export function stripCodesignNoise(stderr: string): string {
  if (!stderr || !CODESIGN_NOISE_RE.test(stderr)) return stderr
  return stderr
    .split('\n')
    .filter((line) => !CODESIGN_NOISE_RE.test(line))
    .join('\n')
}

export function buildPowerShellStdinScript(code: string, nodeExecPath?: string): string {
  const quotedNodeExecPath = nodeExecPath ? `'${nodeExecPath.replaceAll("'", "''")}'` : undefined
  const nodeShim = quotedNodeExecPath
    ? `function node {
  $chatboxPreviousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & ${quotedNodeExecPath} @args
    $chatboxNodeExitCode = $LASTEXITCODE
  } finally {
    if ($null -eq $chatboxPreviousElectronRunAsNode) {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
      $env:ELECTRON_RUN_AS_NODE = $chatboxPreviousElectronRunAsNode
    }
  }
  $global:LASTEXITCODE = $chatboxNodeExitCode
  if ($chatboxNodeExitCode -ne 0) {
    $chatboxNodeException = [Exception]::new('Bundled node process failed')
    $chatboxNodeException.Data['ChatboxNodeExitCode'] = $chatboxNodeExitCode
    throw $chatboxNodeException
  }
}

`
    : ''
  return `${POWERSHELL_UTF8_PREAMBLE}\n${nodeShim}${code}\n`
}

/**
 * Build the program text fed to the sandbox process via stdin. The code NEVER travels inside a
 * shell command — it goes on stdin — so there is no shell escaping and no base64 round-trip.
 *
 * `node`: the code is the program itself (the runtime reads it from stdin).
 * `powershell`: prepend an ASCII-only UTF-8 setup before the user program so both PowerShell 7
 * and Windows PowerShell decode stdin/stdout consistently.
 * `bash`: parse the complete program as a command group before executing it with stdin redirected
 * from /dev/null. This preserves the old one-shot execution contract: commands such as `cat` and
 * `read` see EOF instead of consuming the remaining script source. On macOS/Linux, prepend a
 * `node()` shell function so user scripts can call the bundled Electron binary (there is no
 * standalone `node` on the sandbox PATH). Windows keeps the shell's own `node` resolution because
 * a host Electron path cannot be executed by the WSL fallback. Windows also wraps Bash's `cd`
 * builtin so native paths such as `C:\Users\name` are converted through Git Bash's `cygpath` or
 * WSL's `wslpath` before changing directory.
 */
export function buildSandboxStdinScript(
  code: string,
  language: SandboxExecLanguage,
  nodeExecPath: string,
  injectNodeShim: boolean,
  injectWindowsCdShim = false
): string {
  if (language === 'node') return code
  if (language === 'powershell') return buildPowerShellStdinScript(code)
  const nodeShim = injectNodeShim ? `node() { ELECTRON_RUN_AS_NODE=1 ${shellQuote(nodeExecPath)} "$@"; }\n` : ''
  const windowsCdShim = injectWindowsCdShim ? WINDOWS_CD_SHIM : ''
  // The leading no-op keeps empty and comment-only programs valid without masking the exit status
  // of the user's final command.
  // Pipefail keeps failures from commands such as `git push | tail` visible to the retry policy.
  // Keep a blank line before the closing brace so a trailing backslash retains its normal EOF
  // behavior instead of escaping the brace's newline and corrupting the wrapper syntax.
  return `${nodeShim}${windowsCdShim}set -o pipefail\n{\n:\n${code}\n\n} </dev/null`
}
