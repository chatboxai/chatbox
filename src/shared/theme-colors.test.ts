import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERFACE_COLORS,
  deriveDarkSurfaceColors,
  INTERFACE_COLOR_PRESETS,
  isInterfaceBrandColorAllowed,
  renameInterfaceColorPreset,
  resolveDarkSurfaceOverrides,
  resolveInterfaceBrandColor,
  resolveInterfaceBrandColors,
  withColorOpacity,
} from './theme-colors'

describe('INTERFACE_COLOR_PRESETS', () => {
  it('provides the default, Claude, and Mist Blue presets', () => {
    expect(INTERFACE_COLOR_PRESETS.map((preset) => ({ id: preset.id, label: preset.label }))).toEqual([
      { id: 'default', label: 'Default' },
      { id: 'claude-classic', label: 'Claude Classic' },
      { id: 'mist-blue', label: 'Mist Blue' },
    ])
  })

  it('uses the application default colors for the default preset', () => {
    expect(INTERFACE_COLOR_PRESETS[0].colors).toEqual(DEFAULT_INTERFACE_COLORS)
  })

  it('provides complete light and dark palettes for every preset', () => {
    for (const preset of INTERFACE_COLOR_PRESETS) {
      expect(preset.colors.light).toEqual({
        backgroundPrimary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        backgroundSecondary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        backgroundTertiary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        brand: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      })
      expect(preset.colors.dark).toEqual({
        backgroundPrimary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        backgroundSecondary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        backgroundTertiary: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        brand: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      })
    }
  })

  it('uses a 60% alpha channel for preset badge backgrounds', () => {
    expect(withColorOpacity('#d97757', 0.6)).toBe('#d9775799')
  })
})

describe('interface brand color', () => {
  it('rejects white regardless of letter case', () => {
    expect(isInterfaceBrandColorAllowed('#ffffff')).toBe(false)
    expect(isInterfaceBrandColorAllowed('#FFFFFF')).toBe(false)
  })

  it('replaces white with the default brand color for the active theme', () => {
    expect(resolveInterfaceBrandColor('#ffffff', 'light')).toBe('#228be6')
    expect(resolveInterfaceBrandColor('#FFFFFF', 'dark')).toBe('#228be6')
    expect(resolveInterfaceBrandColor('#123456', 'light')).toBe('#123456')
  })

  it('replaces white brand colors across a complete palette', () => {
    expect(
      resolveInterfaceBrandColors({
        light: { ...INTERFACE_COLOR_PRESETS[0].colors.light, brand: '#ffffff' },
        dark: { ...INTERFACE_COLOR_PRESETS[0].colors.dark, brand: '#FFFFFF' },
      })
    ).toEqual({
      light: { ...INTERFACE_COLOR_PRESETS[0].colors.light, brand: '#228be6' },
      dark: { ...INTERFACE_COLOR_PRESETS[0].colors.dark, brand: '#228be6' },
    })
  })
})

describe('renameInterfaceColorPreset', () => {
  const presets = [
    {
      id: 'custom-1',
      label: 'Custom Preset 1',
      colors: INTERFACE_COLOR_PRESETS[0].colors,
    },
  ]

  it('renames the matching preset and trims the label', () => {
    expect(renameInterfaceColorPreset(presets, 'custom-1', '  My Colors  ')[0].label).toBe('My Colors')
  })

  it('does not accept a blank label', () => {
    expect(renameInterfaceColorPreset(presets, 'custom-1', '   ')).toBe(presets)
  })
})

describe('deriveDarkSurfaceColors', () => {
  it('derives the stylesheet grays from the Default dark primary', () => {
    expect(deriveDarkSurfaceColors('#242424')).toEqual({ raised: '#383838', composer: '#454545' })
  })

  it('tints the surfaces toward white from a custom primary', () => {
    expect(deriveDarkSurfaceColors('#000624')).toEqual({ raised: '#171c38', composer: '#262b45' })
    expect(deriveDarkSurfaceColors('#000624'.toUpperCase())).toEqual({ raised: '#171c38', composer: '#262b45' })
  })

  it('accepts 3-digit hex', () => {
    expect(deriveDarkSurfaceColors('#222')).toEqual(deriveDarkSurfaceColors('#222222'))
  })

  it('returns null for unsupported colors', () => {
    for (const color of ['', '242424', '#24242', '#2424244d', 'rgb(36, 36, 36)', '#gggggg']) {
      expect(deriveDarkSurfaceColors(color)).toBeNull()
    }
  })
})

describe('resolveDarkSurfaceOverrides', () => {
  const withDarkPrimary = (backgroundPrimary: string) => ({
    ...DEFAULT_INTERFACE_COLORS,
    dark: { ...DEFAULT_INTERFACE_COLORS.dark, backgroundPrimary },
  })

  it('keeps the stylesheet surfaces for built-in dark presets', () => {
    for (const preset of INTERFACE_COLOR_PRESETS) {
      expect(resolveDarkSurfaceOverrides(preset.colors, 'dark')).toBeNull()
      expect(
        resolveDarkSurfaceOverrides(withDarkPrimary(preset.colors.dark.backgroundPrimary.toUpperCase()), 'dark')
      ).toBeNull()
    }
  })

  it('overrides the surfaces for a custom dark primary', () => {
    expect(resolveDarkSurfaceOverrides(withDarkPrimary('#000624'), 'dark')).toEqual({
      raised: '#171c38',
      composer: '#262b45',
    })
  })

  it('keeps the stylesheet surfaces in light mode', () => {
    expect(resolveDarkSurfaceOverrides(withDarkPrimary('#000624'), 'light')).toBeNull()
  })

  it('keeps the stylesheet surfaces for an unsupported custom primary', () => {
    expect(resolveDarkSurfaceOverrides(withDarkPrimary('not-a-color'), 'dark')).toBeNull()
  })
})
