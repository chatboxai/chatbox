#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), '..')

export const DESKTOP_AUTOMATION_ARTIFACTS = [
  'out/main/main.js',
  'out/preload/index.js',
  'out/renderer/index.html',
]

export const DESKTOP_AUTOMATION_SOURCE_ROOTS = [
  'src/main',
  'src/preload',
  'src/renderer',
  'src/shared',
  'packages',
  'electron.vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'release/app/package.json',
  'postcss.config.js',
  'tsconfig.json',
  'scripts/build-mobile-work-worker.cjs',
]

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
])

export function newestMtime(root, relativePath) {
  const full = path.join(root, relativePath)
  if (!existsSync(full)) return 0
  const stats = statSync(full)
  if (stats.isFile()) return stats.mtimeMs
  let newest = stats.mtimeMs
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    newest = Math.max(newest, newestMtime(root, path.join(relativePath, entry.name)))
  }
  return newest
}

export function desktopAutomationBuildStatus(root) {
  const missing = DESKTOP_AUTOMATION_ARTIFACTS.filter((file) => !existsSync(path.join(root, file)))
  if (missing.length > 0) {
    return { needed: true, reason: `missing ${missing.join(', ')}` }
  }

  const artifactAge = Math.min(
    ...DESKTOP_AUTOMATION_ARTIFACTS.map((file) => statSync(path.join(root, file)).mtimeMs)
  )
  let sourceAge = 0
  let newestSource = ''
  for (const source of DESKTOP_AUTOMATION_SOURCE_ROOTS) {
    const age = newestMtime(root, source)
    if (age > sourceAge) {
      sourceAge = age
      newestSource = source
    }
  }

  if (sourceAge > artifactAge) {
    return { needed: true, reason: `${newestSource} is newer than out/` }
  }
  return { needed: false, reason: 'out/ is current' }
}

export function ensureDesktopAutomationBuild({
  root = defaultRepositoryRoot,
  env = process.env,
  log = console,
  runBuild = defaultRunBuild,
} = {}) {
  if (env.SKIP_DESKTOP_AUTOMATION_BUILD === '1') {
    log.info?.('skip desktop automation build (SKIP_DESKTOP_AUTOMATION_BUILD=1)')
    return { built: false, skipped: true }
  }

  const status = desktopAutomationBuildStatus(root)
  if (!status.needed) {
    log.info?.(`desktop automation build is current (${status.reason})`)
    return { built: false, skipped: false }
  }

  log.info?.(`desktop automation build needed: ${status.reason}`)
  runBuild(root, env)
  return { built: true, skipped: false }
}

function defaultRunBuild(root, env) {
  const result = spawnSync('pnpm', ['exec', 'electron-vite', 'build', '--mode', 'development'], {
    cwd: root,
    env: { ...env, CI: env.CI || 'true' },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error('electron-vite development build failed')
  }
}

function isMainModule() {
  const invoked = process.argv[1] && path.resolve(process.argv[1])
  return invoked === scriptPath
}

if (isMainModule()) {
  try {
    ensureDesktopAutomationBuild()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
