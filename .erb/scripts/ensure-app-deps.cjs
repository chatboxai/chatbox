/**
 * beforePack hook for electron-builder.
 *
 * With pnpm's node-linker=hoisted, dependencies declared in
 * release/app/package.json get hoisted to the workspace root
 * node_modules/ instead of release/app/node_modules/.
 * electron-builder only packages release/app/node_modules/,
 * so transitive deps like detect-libc, node-fetch, zod end up
 * missing from the asar.
 *
 * This script runs `npm ci --omit=dev` in release/app/
 * to create a complete, flat node_modules/ before packaging,
 * then removes dev-only artifacts that shouldn't ship.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { verifyInstalledRuntimeDeps } = require('./runtime-deps.cjs')

exports.default = async function ensureAppDeps(context) {
  const appDir = path.join(__dirname, '..', '..', 'release', 'app')
  const nodeModulesDir = path.join(appDir, 'node_modules')

  // Remove pnpm's incomplete hoisted node_modules if it exists
  if (fs.existsSync(nodeModulesDir)) {
    fs.rmSync(nodeModulesDir, { recursive: true, force: true })
  }

  console.log('[ensure-app-deps] Installing production dependencies in release/app/ ...')
  execSync('npm ci --omit=dev --ignore-scripts', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_registry: 'https://registry.npmmirror.com' },
  })

  verifyInstalledRuntimeDeps(appDir)
  verifyVersionsMatchPnpmWorkspace(appDir)

  // Remove type-only packages that are not needed at runtime.
  // @anthropic-ai/sandbox-runtime incorrectly lists @types/lodash-es
  // in production dependencies, pulling in @types/* and undici-types.
  const packagesToRemove = ['@types', 'undici-types']
  for (const pkg of packagesToRemove) {
    const pkgPath = path.join(nodeModulesDir, pkg)
    if (fs.existsSync(pkgPath)) {
      fs.rmSync(pkgPath, { recursive: true, force: true })
      console.log(`[ensure-app-deps] Removed dev-only package: ${pkg}`)
    }
  }

  console.log('[ensure-app-deps] Done.')
}

/**
 * Guard against version skew between release/app/package-lock.json (used by
 * `npm ci` to materialize node_modules) and the root pnpm-lock.yaml (used by
 * electron-builder's pnpm node-module collector).
 *
 * electron-builder detects this repo as a pnpm workspace and resolves the
 * packaged dependency tree via `pnpm list`, while the physical node_modules is
 * created by npm. If the two lockfiles resolve a package to different versions,
 * the collector cannot find the expected version on disk and silently drops the
 * package from the asar — e.g. ws@8.20.0 on disk vs ws@8.19.0 expected caused
 * `Cannot find module 'ws'` at app startup. Keep the versions aligned (e.g.
 * via "overrides" in release/app/package.json); this check makes any future
 * skew fail the build loudly instead of shipping a broken app.
 *
 * `pnpm list` runs after `npm ci` has replaced release/app/node_modules, so the
 * directory has no pnpm install metadata; `--lockfile-only` makes pnpm build
 * the tree from the lockfile instead of inspecting node_modules, which keeps
 * this check reliable regardless of the node_modules state.
 *
 * Type-only packages (@types/*, undici-types) are excluded: they are removed
 * from disk before packaging and never needed at runtime.
 */
function readPnpmProductionDependencyTree(appDir) {
  return execSync(
    'pnpm list --prod --json --depth Infinity --silent --loglevel=error --lockfile-only',
    {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COREPACK_ENABLE_STRICT: '0' },
    },
  ).toString()
}

function verifyVersionsMatchPnpmWorkspace(appDir, options = {}) {
  const readPnpmList = options.readPnpmList || readPnpmProductionDependencyTree
  let pnpmList
  try {
    const output = readPnpmList(appDir)
    pnpmList = JSON.parse(output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[ensure-app-deps] failed to verify versions against pnpm workspace lockfile: ${message}`,
    )
  }

  const pnpmVersions = new Map()
  const walk = (node) => {
    for (const [depName, dep] of Object.entries(node?.dependencies || {})) {
      if (dep && dep.version) {
        pnpmVersions.set(depName, dep.version)
      }
      walk(dep)
    }
  }
  walk(Array.isArray(pnpmList) ? pnpmList[0] : pnpmList)

  if (pnpmVersions.size === 0) {
    // Fail closed: an empty tree means the check saw nothing to compare, which
    // would silently report every skew as verified. Better to fail the build
    // than to ship a package with missing runtime dependencies again.
    throw new Error(
      '[ensure-app-deps] pnpm list returned no production dependencies — cannot verify version alignment with the pnpm workspace lockfile. ' +
        'Run `pnpm list --prod --json --lockfile-only` in release/app/ to debug.',
    )
  }

  const npmLock = JSON.parse(fs.readFileSync(path.join(appDir, 'package-lock.json'), 'utf8'))
  const mismatches = []
  for (const [name, pnpmVersion] of pnpmVersions) {
    if (name.startsWith('@types/') || name === 'undici-types') {
      continue
    }
    const npmKey = Object.keys(npmLock.packages).find((key) => {
      return key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)
    })
    const npmVersion = npmKey != null ? npmLock.packages[npmKey].version : undefined
    if (npmVersion !== pnpmVersion) {
      mismatches.push(`  ${name}: npm lock ${npmVersion ?? '(missing)'} != pnpm lock ${pnpmVersion}`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `[ensure-app-deps] version skew between release/app/package-lock.json and the pnpm workspace lockfile:\n${mismatches.join('\n')}\n` +
        'Align the versions (e.g. via "overrides" in release/app/package.json), otherwise the packaged app will silently miss runtime dependencies.',
    )
  }

  console.log('[ensure-app-deps] verified dependency versions match pnpm workspace lockfile')
}

exports.verifyVersionsMatchPnpmWorkspace = verifyVersionsMatchPnpmWorkspace
