import { describe, expect, it } from 'vitest'
import {
  applyDevLaunchHashToUrl,
  buildDevLaunchHash,
  hasCommandLineFlag,
  parseDevLaunchOptions,
  parseStartPage,
  readCommandLineOption,
  shouldNavigateToStartPage,
  shouldSkipOnboardingGuide,
  splitLaunchPath,
} from './dev-launch'

describe('readCommandLineOption', () => {
  it('reads inline and separated values', () => {
    expect(readCommandLineOption(['electron', '--start-page=/settings'], 'start-page')).toBe('/settings')
    expect(readCommandLineOption(['electron', '--start-page', '/settings/mcp'], 'start-page')).toBe('/settings/mcp')
  })

  it('does not treat the next flag as a value', () => {
    expect(readCommandLineOption(['electron', '--skip-guide', '--user-data-dir=/tmp/qa'], 'skip-guide')).toBeNull()
  })
})

describe('hasCommandLineFlag', () => {
  it('accepts a bare flag and truthy inline values', () => {
    expect(hasCommandLineFlag(['electron', '--skip-guide'], 'skip-guide')).toBe(true)
    expect(hasCommandLineFlag(['electron', '--skip-guide=1'], 'skip-guide')).toBe(true)
    expect(hasCommandLineFlag(['electron', '--skip-guide=true'], 'skip-guide')).toBe(true)
  })

  it('rejects missing or falsy values', () => {
    expect(hasCommandLineFlag(['electron'], 'skip-guide')).toBe(false)
    expect(hasCommandLineFlag(['electron', '--skip-guide=0'], 'skip-guide')).toBe(false)
    expect(hasCommandLineFlag(['electron', '--skip-guide=false'], 'skip-guide')).toBe(false)
  })
})

describe('parseStartPage', () => {
  it('normalizes hashes and missing leading slashes', () => {
    expect(parseStartPage('#/settings')).toBe('/settings')
    expect(parseStartPage('settings/mcp')).toBe('/settings/mcp')
    expect(parseStartPage('/image-creator')).toBe('/image-creator')
    expect(parseStartPage('/?settings=/settings/mcp')).toBe('/?settings=/settings/mcp')
  })

  it('rejects empty, protocol-relative, oversized, and scheme-like values', () => {
    expect(parseStartPage('')).toBeNull()
    expect(parseStartPage('   ')).toBeNull()
    expect(parseStartPage('//evil.example')).toBeNull()
    expect(parseStartPage('javascript:alert(1)')).toBeNull()
    expect(parseStartPage(`/${'a'.repeat(513)}`)).toBeNull()
    expect(parseStartPage('/settings\n/mcp')).toBeNull()
  })
})

describe('parseDevLaunchOptions', () => {
  it('enables skip-guide from argv, env, or search', () => {
    expect(parseDevLaunchOptions({ argv: ['electron', '--skip-guide'] })).toEqual({
      skipGuide: true,
      startPage: null,
    })
    expect(parseDevLaunchOptions({ env: { CHATBOX_SKIP_GUIDE: '1' } })).toEqual({
      skipGuide: true,
      startPage: null,
    })
    expect(parseDevLaunchOptions({ search: 'skipGuide=1' })).toEqual({
      skipGuide: true,
      startPage: null,
    })
    expect(parseDevLaunchOptions({ search: '?skip-guide=true' })).toEqual({
      skipGuide: true,
      startPage: null,
    })
  })

  it('reads start-page from argv, then env, then search', () => {
    expect(
      parseDevLaunchOptions({
        argv: ['electron', '--start-page=/settings'],
        env: { CHATBOX_START_PAGE: '/about' },
        search: 'startPage=/copilots',
      })
    ).toEqual({
      skipGuide: true,
      startPage: '/settings',
    })
    expect(
      parseDevLaunchOptions({
        env: { CHATBOX_START_PAGE: '/about' },
        search: 'start-page=/copilots',
      })
    ).toEqual({
      skipGuide: true,
      startPage: '/about',
    })
    expect(parseDevLaunchOptions({ search: 'startPage=/dev' })).toEqual({
      skipGuide: true,
      startPage: '/dev',
    })
  })

  it('implies skip-guide when a start page is present', () => {
    const options = parseDevLaunchOptions({ argv: ['electron', '--start-page=/settings/mcp'] })
    expect(options).toEqual({ skipGuide: true, startPage: '/settings/mcp' })
    expect(shouldSkipOnboardingGuide(options)).toBe(true)
  })

  it('stays inactive without an explicit launch request', () => {
    expect(parseDevLaunchOptions({})).toEqual({ skipGuide: false, startPage: null })
    expect(parseDevLaunchOptions({ env: { CHATBOX_SKIP_GUIDE: '0' } })).toEqual({
      skipGuide: false,
      startPage: null,
    })
  })
})

describe('buildDevLaunchHash', () => {
  it('returns null when no launch override is present', () => {
    expect(buildDevLaunchHash({ skipGuide: false, startPage: null })).toBeNull()
  })

  it('puts skipGuide on the home hash or the requested page', () => {
    expect(buildDevLaunchHash({ skipGuide: true, startPage: null })).toBe('/?skipGuide=1')
    expect(buildDevLaunchHash({ skipGuide: true, startPage: '/settings' })).toBe(
      '/settings?skipGuide=1&startPage=%2Fsettings'
    )
    expect(buildDevLaunchHash({ skipGuide: true, startPage: '/?settings=/settings/mcp' })).toBe(
      '/?settings=%2Fsettings%2Fmcp&skipGuide=1&startPage=%2F%3Fsettings%3D%2Fsettings%2Fmcp'
    )
  })
})

describe('applyDevLaunchHashToUrl', () => {
  it('appends a hash history entry to a renderer origin', () => {
    expect(applyDevLaunchHashToUrl('http://localhost:1212', '/settings?skipGuide=1')).toBe(
      'http://localhost:1212/#/settings?skipGuide=1'
    )
    expect(applyDevLaunchHashToUrl('http://localhost:1212/', '/?skipGuide=1')).toBe(
      'http://localhost:1212/#/?skipGuide=1'
    )
  })

  it('leaves the base URL unchanged without a hash', () => {
    expect(applyDevLaunchHashToUrl('http://localhost:1212', null)).toBe('http://localhost:1212')
  })
})

describe('shouldNavigateToStartPage', () => {
  it('navigates when the current route differs', () => {
    expect(shouldNavigateToStartPage('/settings', '/', {})).toBe(true)
    expect(shouldNavigateToStartPage('/settings/', '/settings', {})).toBe(false)
    expect(shouldNavigateToStartPage('/?settings=/settings/mcp', '/', { settings: '/settings/mcp' })).toBe(false)
    expect(shouldNavigateToStartPage('/?settings=/settings/mcp', '/', {})).toBe(true)
  })
})

describe('splitLaunchPath', () => {
  it('drops skipGuide from the remaining search object', () => {
    expect(splitLaunchPath('/settings?skipGuide=1&foo=bar')).toEqual({
      pathname: '/settings',
      search: { foo: 'bar' },
    })
  })
})
