import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const WORKSPACE_GUARD_SCHEMA_VERSION = 1
export const WORKSPACE_GUARD_STAMP_FILE = '.chatbox-workspace-stamp.json'

function getStampPath(rootDir) {
  return path.join(rootDir, 'node_modules', WORKSPACE_GUARD_STAMP_FILE)
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function readText(filePath) {
  return readFile(filePath, 'utf8')
}

async function readPackageInstallInputs(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json')
  const packageJson = JSON.parse(await readText(packageJsonPath))

  return {
    engines: packageJson.engines ?? {},
    packageManager: packageJson.packageManager ?? null,
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
    peerDependencies: packageJson.peerDependencies ?? {},
    pnpm: packageJson.pnpm ?? null,
  }
}

async function readWorkspaceFingerprintInputs(rootDir) {
  const [packageInstallInputs, lockfile, nodeVersion] = await Promise.all([
    readPackageInstallInputs(rootDir),
    readText(path.join(rootDir, 'pnpm-lock.yaml')),
    readText(path.join(rootDir, '.node-version')),
  ])

  return {
    expectedNodeVersion: nodeVersion.trim(),
    fingerprint: hashText(
      JSON.stringify({
        packageInstallInputs,
        lockfile,
        nodeVersion: nodeVersion.trim(),
      })
    ),
  }
}

export function parseMajorVersion(version) {
  const match = version.trim().match(/^v?(?<major>\d+)/)
  if (!match?.groups?.major) {
    throw new Error(`Unable to parse Node version: ${version}`)
  }

  return Number.parseInt(match.groups.major, 10)
}

export async function readWorkspaceStamp(rootDir) {
  try {
    const stamp = JSON.parse(await readText(getStampPath(rootDir)))
    return stamp
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function writeWorkspaceStamp({ rootDir, nodeVersion = process.version }) {
  const { fingerprint, expectedNodeVersion } = await readWorkspaceFingerprintInputs(rootDir)
  const stampPath = getStampPath(rootDir)

  await mkdir(path.dirname(stampPath), { recursive: true })

  const stamp = {
    schemaVersion: WORKSPACE_GUARD_SCHEMA_VERSION,
    fingerprint,
    expectedNodeVersion,
    nodeVersion,
    createdAt: new Date().toISOString(),
  }

  await writeFile(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8')

  return stamp
}

export async function verifyWorkspaceReady({ rootDir, nodeVersion = process.version }) {
  const diagnostics = []
  const { fingerprint, expectedNodeVersion } = await readWorkspaceFingerprintInputs(rootDir)
  const currentMajor = parseMajorVersion(nodeVersion)
  const expectedMajor = parseMajorVersion(expectedNodeVersion)

  if (currentMajor !== expectedMajor) {
    diagnostics.push(
      `Node ${nodeVersion} is active, but this repo expects Node ${expectedNodeVersion} (${expectedMajor}.x).`
    )
  }

  const stamp = await readWorkspaceStamp(rootDir)

  if (!stamp) {
    diagnostics.push(
      'Workspace install stamp is missing. This worktree has not recorded a successful `pnpm install` for the current dependency state.'
    )
  } else if (stamp.schemaVersion !== WORKSPACE_GUARD_SCHEMA_VERSION || stamp.fingerprint !== fingerprint) {
    diagnostics.push(
      'Workspace install stamp is stale. Dependency inputs changed since the last `pnpm install` in this worktree.'
    )
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    expectedNodeVersion,
    fingerprint,
    stamp,
  }
}

function printDiagnostics(diagnostics) {
  process.stderr.write('[workspace-guard] Workspace is not ready.\n')
  for (const diagnostic of diagnostics) {
    process.stderr.write(`[workspace-guard] ${diagnostic}\n`)
  }
  process.stderr.write(
    '[workspace-guard] Fix: switch to the pinned Node line from `.node-version`, then run `pnpm install` in this worktree before retrying.\n'
  )
}

export async function runWorkspaceGuardCli({
  args = process.argv.slice(2),
  rootDir = process.cwd(),
  nodeVersion = process.version,
} = {}) {
  if (args.includes('--record-install-state')) {
    const stamp = await writeWorkspaceStamp({ rootDir, nodeVersion })
    process.stdout.write(
      `[workspace-guard] Recorded install state at ${path.relative(rootDir, getStampPath(rootDir))}.\n`
    )
    return {
      ok: true,
      stamp,
      exitCode: 0,
    }
  }

  const result = await verifyWorkspaceReady({ rootDir, nodeVersion })
  if (result.ok) {
    return {
      ...result,
      exitCode: 0,
    }
  }

  printDiagnostics(result.diagnostics)

  return {
    ...result,
    exitCode: 1,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode } = await runWorkspaceGuardCli()
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
