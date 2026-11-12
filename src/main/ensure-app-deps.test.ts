import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface EnsureAppDepsModule {
  getProjectRegistry: (projectDir: string, options?: { readNpmrc?: (projectDir: string) => string }) => string
  verifyVersionsMatchPnpmWorkspace: (appDir: string, options?: { readPnpmList?: (appDir: string) => string }) => void
}

const require = createRequire(import.meta.url)
const { getProjectRegistry, verifyVersionsMatchPnpmWorkspace } =
  require('../../.erb/scripts/ensure-app-deps.cjs') as EnsureAppDepsModule

describe('ensure-app-deps registry', () => {
  test('uses the effective registry from the workspace root', () => {
    expect(
      getProjectRegistry('/workspace', {
        readNpmrc: (projectDir) => {
          expect(projectDir).toBe('/workspace')
          return 'registry=https://registry.npmmirror.com\nregistry=https://registry.npmjs.org/\n'
        },
      })
    ).toBe('https://registry.npmjs.org/')
  })

  test('fails when the effective registry is empty', () => {
    expect(() =>
      getProjectRegistry('/workspace', {
        readNpmrc: () => 'auto-install-peers=true\n',
      })
    ).toThrow('[ensure-app-deps] workspace .npmrc must configure a default registry')
  })

  test('keeps the release lockfile switchable by the configured registry', () => {
    const lockfile = fs.readFileSync(new URL('../../release/app/package-lock.json', import.meta.url), 'utf8')
    expect(lockfile).not.toContain('registry.npmmirror.com')
  })
})

describe('ensure-app-deps version guard', () => {
  test('fails closed when pnpm dependency collection fails', () => {
    expect(() =>
      verifyVersionsMatchPnpmWorkspace('/unused', {
        readPnpmList: () => {
          throw new Error('pnpm list failed')
        },
      })
    ).toThrow('[ensure-app-deps] failed to verify versions against pnpm workspace lockfile: pnpm list failed')
  })

  test('fails closed when pnpm returns invalid JSON', () => {
    expect(() =>
      verifyVersionsMatchPnpmWorkspace('/unused', {
        readPnpmList: () => '{invalid',
      })
    ).toThrow('[ensure-app-deps] failed to verify versions against pnpm workspace lockfile:')
  })
})
