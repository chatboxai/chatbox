import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKSPACE_GUARD_STAMP_FILE,
  verifyWorkspaceReady,
  writeWorkspaceStamp,
} from '../../../scripts/workspace-guard.mjs'

const tempDirs: string[] = []

async function createWorkspaceFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'chatbox-workspace-guard-'))
  tempDirs.push(rootDir)

  await mkdir(path.join(rootDir, 'node_modules'), { recursive: true })
  await writeFile(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'workspace-guard-fixture',
        version: '0.0.0',
        scripts: {
          dev: 'pnpm start',
        },
        engines: {
          node: '20.x',
        },
        dependencies: {
          'chess.js': '^1.4.0',
        },
      },
      null,
      2
    )}\n`
  )
  await writeFile(path.join(rootDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await writeFile(path.join(rootDir, '.node-version'), 'v20.20.0\n')

  return rootDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('workspace guard', () => {
  it('accepts a current install stamp when the pinned Node major matches', async () => {
    const rootDir = await createWorkspaceFixture()

    await writeWorkspaceStamp({ rootDir, nodeVersion: 'v20.20.0' })
    const result = await verifyWorkspaceReady({ rootDir, nodeVersion: 'v20.21.1' })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('rejects stale dependency inputs after install', async () => {
    const rootDir = await createWorkspaceFixture()

    await writeWorkspaceStamp({ rootDir, nodeVersion: 'v20.20.0' })
    await writeFile(
      path.join(rootDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'workspace-guard-fixture',
          version: '0.0.0',
          engines: {
            node: '20.x',
          },
          dependencies: {
            'chess.js': '^1.4.0',
            zod: '^3.25.0',
          },
        },
        null,
        2
      )}\n`
    )

    const result = await verifyWorkspaceReady({ rootDir, nodeVersion: 'v20.20.0' })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain(
      'Workspace install stamp is stale. Dependency inputs changed since the last `pnpm install` in this worktree.'
    )
  })

  it('ignores script-only package.json changes when install inputs stay the same', async () => {
    const rootDir = await createWorkspaceFixture()

    await writeWorkspaceStamp({ rootDir, nodeVersion: 'v20.20.0' })
    const packageJsonPath = path.join(rootDir, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

    packageJson.scripts = {
      dev: 'pnpm start',
      smoke: 'pnpm run build',
    }

    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const result = await verifyWorkspaceReady({ rootDir, nodeVersion: 'v20.20.0' })

    expect(result.ok).toBe(true)
    expect(result.stamp?.schemaVersion).toBe(1)
  })

  it('rejects the wrong Node major before the workflow reaches Vite', async () => {
    const rootDir = await createWorkspaceFixture()

    await writeWorkspaceStamp({ rootDir, nodeVersion: 'v20.20.0' })
    const result = await verifyWorkspaceReady({ rootDir, nodeVersion: 'v25.5.0' })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain(
      'Node v25.5.0 is active, but this repo expects Node v20.20.0 (20.x).'
    )
  })

  it('writes the install stamp into node_modules', async () => {
    const rootDir = await createWorkspaceFixture()

    await writeWorkspaceStamp({ rootDir, nodeVersion: 'v20.20.0' })

    const stamp = JSON.parse(await readFile(path.join(rootDir, 'node_modules', WORKSPACE_GUARD_STAMP_FILE), 'utf8'))
    expect(stamp.expectedNodeVersion).toBe('v20.20.0')
  })
})
