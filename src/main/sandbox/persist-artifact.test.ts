import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

// Isolate a fake userData dir so persisted artifacts land somewhere we control & can clean up.
const { USER_DATA } = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os')
  const p = require('node:path') as typeof import('node:path')
  return { USER_DATA: p.join(os.tmpdir(), `chatbox-test-userdata-${process.pid}`) }
})

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => USER_DATA } }))
vi.mock('../util', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { getSandboxArtifactsRoot, getSandboxTmpRoot } from './manager'
import {
  artifactSourceKey,
  hasSessionArtifacts,
  persistSandboxArtifact,
  removeSessionArtifacts,
} from './persist-artifact'

const SESSION_ID = 'session-persist-test'
// realpath the temp root so comparisons match macOS /var → /private/var symlink resolution.
const TMP_SANDBOX_DIR = path.join(getSandboxTmpRoot(), SESSION_ID)

function makeSandboxFile(name: string, content: string): string {
  mkdirSync(TMP_SANDBOX_DIR, { recursive: true })
  const filePath = path.join(TMP_SANDBOX_DIR, name)
  writeFileSync(filePath, content, 'utf-8')
  return realpathSync(filePath)
}

beforeEach(() => {
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(TMP_SANDBOX_DIR, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(TMP_SANDBOX_DIR, { recursive: true, force: true })
})

describe('persistSandboxArtifact', () => {
  test('copies a sandbox file into the durable artifacts root', async () => {
    const source = makeSandboxFile('report.csv', 'a,b,c\n1,2,3\n')

    const result = await persistSandboxArtifact(source, SESSION_ID)

    expect(result.success).toBe(true)
    expect(result.artifactPath).toBeTruthy()
    const artifactsRoot = realpathSync(getSandboxArtifactsRoot())
    expect(result.artifactPath?.startsWith(artifactsRoot + path.sep)).toBe(true)
    expect(existsSync(result.artifactPath!)).toBe(true)
    expect(readFileSync(result.artifactPath!, 'utf-8')).toBe('a,b,c\n1,2,3\n')
    // original basename is preserved so the download dialog suggests a clean name
    expect(path.basename(result.artifactPath!)).toBe('report.csv')
  })

  test('survives deletion of the transient temp file (durable copy)', async () => {
    const source = makeSandboxFile('chart.html', '<html></html>')
    const result = await persistSandboxArtifact(source, SESSION_ID)
    expect(result.success).toBe(true)

    // Simulate temp cleanup / OS tmp eviction.
    rmSync(TMP_SANDBOX_DIR, { recursive: true, force: true })

    expect(existsSync(source)).toBe(false)
    expect(existsSync(result.artifactPath!)).toBe(true)
  })

  test('keeps distinct files that share a basename in different sandbox dirs', async () => {
    mkdirSync(path.join(TMP_SANDBOX_DIR, 'charts'), { recursive: true })
    mkdirSync(path.join(TMP_SANDBOX_DIR, 'tables'), { recursive: true })
    const a = path.join(TMP_SANDBOX_DIR, 'charts', 'report.html')
    const b = path.join(TMP_SANDBOX_DIR, 'tables', 'report.html')
    writeFileSync(a, 'CHARTS', 'utf-8')
    writeFileSync(b, 'TABLES', 'utf-8')

    const ra = await persistSandboxArtifact(realpathSync(a), SESSION_ID)
    const rb = await persistSandboxArtifact(realpathSync(b), SESSION_ID)

    expect(ra.artifactPath).not.toBe(rb.artifactPath)
    // The earlier artifact must not be overwritten by the later same-named one.
    expect(readFileSync(ra.artifactPath!, 'utf-8')).toBe('CHARTS')
    expect(readFileSync(rb.artifactPath!, 'utf-8')).toBe('TABLES')
  })

  test('re-persisting the same source path updates in place', async () => {
    const source = makeSandboxFile('out.txt', 'v1')
    const first = await persistSandboxArtifact(source, SESSION_ID)
    writeFileSync(source, 'v2', 'utf-8')
    const second = await persistSandboxArtifact(source, SESSION_ID)
    expect(second.artifactPath).toBe(first.artifactPath)
    expect(readFileSync(second.artifactPath!, 'utf-8')).toBe('v2')
  })

  test('hasSessionArtifacts / removeSessionArtifacts manage the session dir', async () => {
    expect(hasSessionArtifacts(SESSION_ID)).toBe(false)
    const source = makeSandboxFile('keep.txt', 'data')
    const result = await persistSandboxArtifact(source, SESSION_ID)
    expect(result.success).toBe(true)
    expect(hasSessionArtifacts(SESSION_ID)).toBe(true)

    const removed = removeSessionArtifacts(SESSION_ID)
    expect(removed.success).toBe(true)
    expect(hasSessionArtifacts(SESSION_ID)).toBe(false)
    expect(existsSync(result.artifactPath!)).toBe(false)
  })

  test('removeSessionArtifacts rejects a session id with path traversal', () => {
    expect(removeSessionArtifacts('../escape').success).toBe(false)
  })

  test('is idempotent for an already-persisted path', async () => {
    const source = makeSandboxFile('data.json', '{"ok":true}')
    const first = await persistSandboxArtifact(source, SESSION_ID)
    expect(first.success).toBe(true)

    const second = await persistSandboxArtifact(first.artifactPath!, SESSION_ID)
    expect(second.success).toBe(true)
    expect(second.artifactPath).toBe(first.artifactPath)
  })

  test('refreshes a persisted artifact when the original working-directory file changed', async () => {
    const source = makeSandboxFile('site.html', 'v1')
    const first = await persistSandboxArtifact(source, SESSION_ID)
    expect(first.success).toBe(true)
    writeFileSync(source, 'v2', 'utf-8')

    const second = await persistSandboxArtifact(first.artifactPath!, SESSION_ID)
    expect(second.success).toBe(true)
    expect(second.artifactPath).toBe(first.artifactPath)
    expect(readFileSync(first.artifactPath!, 'utf-8')).toBe('v2')
  })

  test('does not refresh a persisted artifact from a different same-named working file', async () => {
    mkdirSync(path.join(TMP_SANDBOX_DIR, 'charts'), { recursive: true })
    const nested = path.join(TMP_SANDBOX_DIR, 'charts', 'report.html')
    writeFileSync(nested, 'CHARTS', 'utf-8')
    const first = await persistSandboxArtifact(realpathSync(nested), SESSION_ID)
    writeFileSync(path.join(TMP_SANDBOX_DIR, 'report.html'), 'ROOT', 'utf-8')

    const second = await persistSandboxArtifact(first.artifactPath!, SESSION_ID)
    expect(second.artifactPath).toBe(first.artifactPath)
    expect(readFileSync(first.artifactPath!, 'utf-8')).toBe('CHARTS')
  })

  test.skipIf(process.platform === 'win32')(
    'persists a file from a sandbox-writable temp dir (e.g. /tmp)',
    async () => {
      // The sandbox can legitimately write to the OS temp dir / /tmp, so create_download
      // must be able to persist files produced there even though they live outside the
      // per-session working directory.
      const tempFile = path.join(tmpdir(), `persist-tmp-${process.pid}.txt`)
      writeFileSync(tempFile, 'from-tmp', 'utf-8')
      try {
        const result = await persistSandboxArtifact(realpathSync(tempFile), SESSION_ID)
        expect(result.success).toBe(true)
        const artifactsRoot = realpathSync(getSandboxArtifactsRoot())
        expect(result.artifactPath?.startsWith(artifactsRoot + path.sep)).toBe(true)
        expect(readFileSync(result.artifactPath!, 'utf-8')).toBe('from-tmp')
      } finally {
        rmSync(tempFile, { force: true })
      }
    }
  )

  test.runIf(process.platform === 'win32')('rejects files from the unrestricted Windows temp directory', async () => {
    // Windows code execution redirects TMP/TEMP to the per-session working directory and
    // does not grant the unrestricted OS temp root. Accepting it here would let an agent
    // persist files created by unrelated processes as sandbox artifacts.
    const tempFile = path.join(tmpdir(), `persist-windows-tmp-${process.pid}.txt`)
    writeFileSync(tempFile, 'outside-session', 'utf-8')
    try {
      const result = await persistSandboxArtifact(realpathSync(tempFile), SESSION_ID)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/outside the sandbox/i)
    } finally {
      rmSync(tempFile, { force: true })
    }
  })

  test('rejects a path outside the sandbox-writable area', async () => {
    // A path under the user's home dir is neither a sandbox root nor a sandbox-writable
    // temp location, so it must not be persistable as a download. The allowlist check runs
    // before the existence check, so no real file needs to be created here.
    const outside = path.join(homedir(), `not-a-sandbox-${process.pid}.txt`)
    const result = await persistSandboxArtifact(outside, SESSION_ID)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/outside the sandbox/i)
  })

  test('resolves a relative path from the session sandbox directory', async () => {
    makeSandboxFile('relative.txt', 'relative artifact')

    const result = await persistSandboxArtifact('relative.txt', SESSION_ID)

    expect(result.success).toBe(true)
    expect(result.artifactPath).toBeTruthy()
    if (result.artifactPath) {
      expect(readFileSync(result.artifactPath, 'utf8')).toBe('relative artifact')
    }
  })

  test('rejects a file from another session sandbox directory', async () => {
    const otherSessionDir = path.join(getSandboxTmpRoot(), 'other-session')
    mkdirSync(otherSessionDir, { recursive: true })
    const source = path.join(otherSessionDir, 'private.txt')
    writeFileSync(source, 'other session', 'utf8')

    const result = await persistSandboxArtifact(realpathSync(source), SESSION_ID)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/outside the sandbox/i)
    rmSync(otherSessionDir, { recursive: true, force: true })
  })

  test('rejects a durable artifact owned by another session', async () => {
    const otherSessionArtifact = path.join(getSandboxArtifactsRoot(), 'other-session', 'source', 'private.txt')
    mkdirSync(path.dirname(otherSessionArtifact), { recursive: true })
    writeFileSync(otherSessionArtifact, 'other artifact', 'utf8')

    const result = await persistSandboxArtifact(realpathSync(otherSessionArtifact), SESSION_ID)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/outside the sandbox/i)
  })

  test('rejects a directory instead of exposing it as a downloadable artifact', async () => {
    const directory = path.join(getSandboxArtifactsRoot(), SESSION_ID, 'directory')
    mkdirSync(directory, { recursive: true })

    const result = await persistSandboxArtifact(realpathSync(directory), SESSION_ID)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not a file/i)
  })

  test('rejects a relative path that escapes the session sandbox directory', async () => {
    const result = await persistSandboxArtifact('../escape.txt', SESSION_ID)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/escapes the sandbox/i)
  })

  test('rejects a session id with path traversal', async () => {
    const source = makeSandboxFile('x.txt', 'x')
    const result = await persistSandboxArtifact(source, '../escape')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid session id/i)
  })

  test('returns not found for a missing file inside the sandbox root', async () => {
    mkdirSync(TMP_SANDBOX_DIR, { recursive: true })
    const missing = path.join(realpathSync(TMP_SANDBOX_DIR), 'missing.txt')
    const result = await persistSandboxArtifact(missing, SESSION_ID)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/file not found/i)
  })

  test('hashes source paths stably so same-named files in different dirs stay distinct', () => {
    expect(artifactSourceKey('/tmp/charts/report.html')).not.toBe(artifactSourceKey('/tmp/tables/report.html'))
    expect(artifactSourceKey('/tmp/report.html')).toBe(artifactSourceKey('/tmp/report.html'))
  })
})
