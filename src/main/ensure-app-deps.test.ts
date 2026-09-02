import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

interface EnsureAppDepsModule {
  verifyVersionsMatchPnpmWorkspace: (appDir: string, options?: { readPnpmList?: (appDir: string) => string }) => void
}

const require = createRequire(import.meta.url)
const { verifyVersionsMatchPnpmWorkspace } = require('../../.erb/scripts/ensure-app-deps.cjs') as EnsureAppDepsModule

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
