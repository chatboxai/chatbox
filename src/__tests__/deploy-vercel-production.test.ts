import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const scriptPath = path.join(repoRoot, 'scripts', 'deploy-vercel-production.sh')
const projectJson = '.vercel/project.json'

function writeExecutable(filePath: string, contents: string) {
  writeFileSync(filePath, contents)
  chmodSync(filePath, 0o755)
}

function createFakeBin(successStdout: boolean) {
  const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'chatbox-vercel-bin-'))
  const deployStdout = successStdout
    ? "printf '%s\\n' 'https://chatbox-ljd989cwa-thisisyoussefs-projects.vercel.app'\n"
    : ''

  writeExecutable(
    path.join(fakeBinDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-}" != "build:web" ]; then
  echo "unexpected pnpm command: $*" >&2
  exit 98
fi

echo "fake pnpm build:web" >&2
`,
  )

  writeExecutable(
    path.join(fakeBinDir, 'vercel'),
    `#!/usr/bin/env bash
set -euo pipefail

cmd="\${1:-}"
shift || true

case "$cmd" in
  pull)
    exit 0
    ;;
  deploy)
    ${deployStdout}printf '\\033[2K\\033[1A\\033[2K\\033[GProduction: https://chatbox-ljd989cwa-thisisyoussefs-projects.vercel.app [3m]\\n' >&2
    printf 'Completing...\\n' >&2
    printf 'Aliased: https://chatbox-web-two.vercel.app [3m]\\n' >&2
    printf 'binary:\\0chunk\\n' >&2
    exit 0
    ;;
  *)
    echo "unexpected vercel subcommand: $cmd" >&2
    exit 99
    ;;
esac
`,
  )

  return fakeBinDir
}

function runDeployScript(successStdout: boolean) {
  const fakeBinDir = createFakeBin(successStdout)
  const logDir = mkdtempSync(path.join(tmpdir(), 'chatbox-vercel-log-'))
  const logPath = path.join(logDir, 'deploy.log')

  const result = spawnSync(scriptPath, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      LOG_FILE: logPath,
      PROJECT_JSON: projectJson,
      VERCEL_ORG_ID: 'team_test',
      VERCEL_PROJECT_ID: 'prj_test',
      VERCEL_TOKEN: 'token_test',
      GITHUB_SHA: '71c4a761740fdd6a1ca3ab7b335e92cd607fda81',
    },
  })

  return {
    ...result,
    logPath,
    logBuffer: readFileSync(logPath),
    cleanup() {
      rmSync(fakeBinDir, { force: true, recursive: true })
      rmSync(logDir, { force: true, recursive: true })
    },
  }
}

describe('deploy-vercel-production.sh', () => {
  it('returns the deployment URL from Vercel stdout even when stderr is ANSI-tainted', () => {
    const result = runDeployScript(true)

    try {
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(
        'https://chatbox-ljd989cwa-thisisyoussefs-projects.vercel.app',
      )
      expect(result.stderr).toContain('Aliased: https://chatbox-web-two.vercel.app [3m]')
      expect(result.logBuffer.includes(0)).toBe(true)
      expect(result.logBuffer.toString('utf8')).toContain('Production:')
    } finally {
      result.cleanup()
    }
  })

  it('fails when Vercel does not emit a deployment URL on stdout', () => {
    const result = runDeployScript(false)

    try {
      expect(result.status).toBe(1)
      expect(result.stdout.trim()).toBe('')
      expect(result.stderr).toContain(
        'Could not determine deployment URL from Vercel stdout',
      )
    } finally {
      result.cleanup()
    }
  })
})
