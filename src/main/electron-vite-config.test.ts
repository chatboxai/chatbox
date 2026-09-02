import { describe, expect, test } from 'vitest'
import { getRendererDevServerConfig, shouldBuildElectronViteTarget } from '../../electron.vite.config'

describe('shouldBuildElectronViteTarget', () => {
  test('builds every target when no target is requested', () => {
    expect(shouldBuildElectronViteTarget('main', undefined)).toBe(true)
    expect(shouldBuildElectronViteTarget('preload', undefined)).toBe(true)
    expect(shouldBuildElectronViteTarget('renderer', undefined)).toBe(true)
  })

  test('builds only the requested target', () => {
    expect(shouldBuildElectronViteTarget('main', 'renderer')).toBe(false)
    expect(shouldBuildElectronViteTarget('preload', 'renderer')).toBe(false)
    expect(shouldBuildElectronViteTarget('renderer', 'renderer')).toBe(true)
  })

  test('rejects an invalid target', () => {
    expect(() => shouldBuildElectronViteTarget('main', 'desktop')).toThrow(
      'Invalid CHATBOX_ELECTRON_VITE_TARGET "desktop"'
    )
  })
})

describe('getRendererDevServerConfig', () => {
  test('keeps the current default outside QA mode', () => {
    expect(getRendererDevServerConfig({})).toEqual({ port: 1212, strictPort: false })
    expect(getRendererDevServerConfig({ DEV_PORT: '12123' })).toEqual({ port: 12123, strictPort: false })
  })

  test('requires and locks an explicit renderer port in QA mode', () => {
    expect(getRendererDevServerConfig({ CHATBOX_QA: '1', DEV_PORT: '12121' })).toEqual({
      port: 12121,
      strictPort: true,
    })
    expect(() => getRendererDevServerConfig({ CHATBOX_QA: '1' })).toThrow(/DEV_PORT/)
    expect(() => getRendererDevServerConfig({ CHATBOX_QA: '1', DEV_PORT: '0' })).toThrow(/DEV_PORT/)
    expect(() => getRendererDevServerConfig({ CHATBOX_QA: '1', DEV_PORT: '65536' })).toThrow(/DEV_PORT/)
    expect(() => getRendererDevServerConfig({ CHATBOX_QA: '1', DEV_PORT: 'auto' })).toThrow(/DEV_PORT/)
  })
})
