import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DESKTOP_AUTOMATION_ARTIFACTS,
  desktopAutomationBuildStatus,
  ensureDesktopAutomationBuild,
} from './ensure-desktop-automation-build.mjs'

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'desktop-automation-build-'))
  mkdirSync(path.join(root, 'src/main'), { recursive: true })
  mkdirSync(path.join(root, 'src/preload'), { recursive: true })
  mkdirSync(path.join(root, 'src/renderer'), { recursive: true })
  mkdirSync(path.join(root, 'src/shared'), { recursive: true })
  mkdirSync(path.join(root, 'packages'), { recursive: true })
  writeFileSync(path.join(root, 'electron.vite.config.ts'), 'export default {}\n')
  writeFileSync(path.join(root, 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  writeFileSync(path.join(root, 'postcss.config.js'), 'module.exports = {}\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n')
  mkdirSync(path.join(root, 'release/app'), { recursive: true })
  writeFileSync(path.join(root, 'release/app/package.json'), '{}\n')
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, 'scripts/build-mobile-work-worker.cjs'), 'module.exports = {}\n')
  writeFileSync(path.join(root, 'src/main/main.ts'), 'export {}\n')
  return root
}

function writeArtifacts(root, mtimeMs = Date.now()) {
  const atime = new Date()
  const mtime = new Date(mtimeMs)
  for (const file of DESKTOP_AUTOMATION_ARTIFACTS) {
    const full = path.join(root, file)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, 'ok\n')
    utimesSync(full, atime, mtime)
  }
}

function setMtime(root, relativePath, mtimeMs) {
  const time = new Date(mtimeMs)
  utimesSync(path.join(root, relativePath), time, time)
}

test('rebuilds when development artifacts are missing', () => {
  const root = makeRepo()
  try {
    const status = desktopAutomationBuildStatus(root)
    assert.equal(status.needed, true)
    assert.match(status.reason, /missing/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('skips when out/ is newer than product sources', () => {
  const root = makeRepo()
  try {
    writeArtifacts(root, Date.now() + 60_000)
    const status = desktopAutomationBuildStatus(root)
    assert.equal(status.needed, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rebuilds when a product source is newer than out/', () => {
  const root = makeRepo()
  try {
    const artifactTime = Date.now() + 60_000
    writeArtifacts(root, artifactTime)
    writeFileSync(path.join(root, 'src/renderer/App.tsx'), 'export {}\n')
    setMtime(root, 'src/renderer/App.tsx', artifactTime + 60_000)
    const status = desktopAutomationBuildStatus(root)
    assert.equal(status.needed, true)
    assert.match(status.reason, /src\/renderer/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rebuilds when build-mobile-work-worker.cjs is newer than out/', () => {
  const root = makeRepo()
  try {
    const artifactTime = Date.now() + 60_000
    writeArtifacts(root, artifactTime)
    setMtime(root, 'scripts/build-mobile-work-worker.cjs', artifactTime + 60_000)
    const status = desktopAutomationBuildStatus(root)
    assert.equal(status.needed, true)
    assert.match(status.reason, /scripts\/build-mobile-work-worker.cjs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rebuilds when release/app/package.json is newer than out/', () => {
  const root = makeRepo()
  try {
    const artifactTime = Date.now() + 60_000
    writeArtifacts(root, artifactTime)
    setMtime(root, 'release/app/package.json', artifactTime + 60_000)
    const status = desktopAutomationBuildStatus(root)
    assert.equal(status.needed, true)
    assert.match(status.reason, /release\/app\/package.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('honors SKIP_DESKTOP_AUTOMATION_BUILD', () => {
  let built = false
  const result = ensureDesktopAutomationBuild({
    env: { SKIP_DESKTOP_AUTOMATION_BUILD: '1' },
    log: { info() {} },
    runBuild() {
      built = true
    },
  })
  assert.deepEqual(result, { built: false, skipped: true })
  assert.equal(built, false)
})
