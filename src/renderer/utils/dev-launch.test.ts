import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureRendererDevLaunchOptions,
  getRendererDevLaunchOptions,
  readRendererSearch,
  resetRendererDevLaunchOptions,
} from './dev-launch'

describe('readRendererSearch', () => {
  it('prefers query params embedded in the hash history', () => {
    expect(readRendererSearch({ hash: '#/settings?skipGuide=1', search: '?ignored=1' })).toBe('skipGuide=1')
  })

  it('falls back to the browser search string', () => {
    expect(readRendererSearch({ hash: '#/settings', search: '?skipGuide=1' })).toBe('?skipGuide=1')
  })
})

describe('captureRendererDevLaunchOptions', () => {
  beforeEach(() => {
    resetRendererDevLaunchOptions()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads skipGuide from a hash search', () => {
    expect(captureRendererDevLaunchOptions({ hash: '#/?skipGuide=1', search: '' })).toEqual({
      skipGuide: true,
      startPage: null,
    })
  })

  it('reads a start page from browser search', () => {
    expect(captureRendererDevLaunchOptions({ hash: '', search: '?startPage=/settings' })).toEqual({
      skipGuide: true,
      startPage: '/settings',
    })
  })

  it('reads launch defaults from the renderer build environment', () => {
    vi.stubEnv('CHATBOX_SKIP_GUIDE', '1')
    vi.stubEnv('CHATBOX_START_PAGE', '/settings')
    expect(captureRendererDevLaunchOptions({ hash: '', search: '' })).toEqual({
      skipGuide: true,
      startPage: '/settings',
    })
  })

  it('prefers the explicit URL launch target over the renderer build environment', () => {
    vi.stubEnv('CHATBOX_START_PAGE', '/about')
    expect(
      captureRendererDevLaunchOptions({
        hash: '#/settings?skipGuide=1&startPage=%2Fsettings',
        search: '',
      })
    ).toEqual({
      skipGuide: true,
      startPage: '/settings',
    })
  })

  it('keeps the first snapshot after later route rewrites drop the query', () => {
    captureRendererDevLaunchOptions({ hash: '', search: '?skipGuide=1' })
    captureRendererDevLaunchOptions({ hash: '', search: '' })
    expect(getRendererDevLaunchOptions()).toEqual({
      skipGuide: true,
      startPage: null,
    })
  })
})
