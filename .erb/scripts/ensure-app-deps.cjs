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
 * This script runs `npm install --production` in release/app/
 * to create a complete, flat node_modules/ before packaging,
 * then removes dev-only artifacts that shouldn't ship.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const patchMastraRag = require('./patch-mastra-rag.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function removeDir(dir) {
  let lastError
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      sleep(250)
    }
  }
  throw lastError
}

function moveAndRemoveDir(dir) {
  const trashDir = `${dir}.delete-${process.pid}-${Date.now()}`
  fs.renameSync(dir, trashDir)
  removeDir(trashDir)
}

exports.default = async function ensureAppDeps(context) {
  const appDir = path.join(__dirname, '..', '..', 'release', 'app')
  const nodeModulesDir = path.join(appDir, 'node_modules')

  // Remove pnpm's incomplete hoisted node_modules if it exists
  if (fs.existsSync(nodeModulesDir)) {
    moveAndRemoveDir(nodeModulesDir)
  }

  console.log('[ensure-app-deps] Installing production dependencies in release/app/ ...')
  execSync('npm install --omit=dev --ignore-scripts --legacy-peer-deps', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_registry: 'https://registry.npmmirror.com' },
  })

  // Remove type-only packages that are not needed at runtime.
  // @anthropic-ai/sandbox-runtime incorrectly lists @types/lodash-es
  // in production dependencies, pulling in @types/* and undici-types.
  const packagesToRemove = ['@types', 'undici-types']
  for (const pkg of packagesToRemove) {
    const pkgPath = path.join(nodeModulesDir, pkg)
    if (fs.existsSync(pkgPath)) {
      removeDir(pkgPath)
      console.log(`[ensure-app-deps] Removed dev-only package: ${pkg}`)
    }
  }

  // Strip the never-used zeroentropy client so node-fetch@2 (CVE) neither
  // ships nor loads — see patch-mastra-rag.cjs [SEC-5].
  patchMastraRag(appDir)

  console.log('[ensure-app-deps] Done.')
}
