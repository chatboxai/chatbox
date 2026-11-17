export type InterfaceTheme = 'light' | 'dark'

export type InterfaceThemeColors = {
  backgroundPrimary: string
  backgroundSecondary: string
  backgroundTertiary: string
  brand: string
}

export type InterfaceColors = Record<InterfaceTheme, InterfaceThemeColors>

export type InterfaceColorPreset = {
  id: string
  label: string
  colors: InterfaceColors
}

export const DEFAULT_INTERFACE_COLORS: InterfaceColors = {
  light: {
    backgroundPrimary: '#ffffff',
    backgroundSecondary: '#f3f3f3',
    backgroundTertiary: '#dee2e6',
    brand: '#228be6',
  },
  dark: {
    backgroundPrimary: '#242424',
    backgroundSecondary: '#3b3b3b',
    backgroundTertiary: '#424242',
    brand: '#228be6',
  },
}

export const INTERFACE_COLOR_PRESETS = [
  {
    id: 'default',
    label: 'Default',
    colors: DEFAULT_INTERFACE_COLORS,
  },
  {
    id: 'claude-classic',
    label: 'Claude Classic',
    colors: {
      light: {
        backgroundPrimary: '#f7f6f2',
        backgroundSecondary: '#eeede7',
        backgroundTertiary: '#e2e1db',
        brand: '#d97757',
      },
      dark: {
        backgroundPrimary: '#262624',
        backgroundSecondary: '#333330',
        backgroundTertiary: '#41413d',
        brand: '#e89173',
      },
    },
  },
  {
    id: 'mist-blue',
    label: 'Mist Blue',
    colors: {
      light: {
        backgroundPrimary: '#f6f8fa',
        backgroundSecondary: '#eaf0f5',
        backgroundTertiary: '#d9e3ec',
        brand: '#5784aa',
      },
      dark: {
        backgroundPrimary: '#1c252e',
        backgroundSecondary: '#253240',
        backgroundTertiary: '#324252',
        brand: '#7fb3dd',
      },
    },
  },
] satisfies ReadonlyArray<InterfaceColorPreset>

export function getDefaultInterfaceColors(): InterfaceColors {
  return {
    light: { ...DEFAULT_INTERFACE_COLORS.light },
    dark: { ...DEFAULT_INTERFACE_COLORS.dark },
  }
}

export function isInterfaceBrandColorAllowed(color: string): boolean {
  return color.toLowerCase() !== '#ffffff'
}

export function resolveInterfaceBrandColor(color: string, theme: InterfaceTheme): string {
  return isInterfaceBrandColorAllowed(color) ? color : DEFAULT_INTERFACE_COLORS[theme].brand
}

export function resolveInterfaceBrandColors(colors: InterfaceColors): InterfaceColors {
  return {
    light: { ...colors.light, brand: resolveInterfaceBrandColor(colors.light.brand, 'light') },
    dark: { ...colors.dark, brand: resolveInterfaceBrandColor(colors.dark.brand, 'dark') },
  }
}

export function renameInterfaceColorPreset(
  presets: InterfaceColorPreset[],
  presetId: string,
  label: string
): InterfaceColorPreset[] {
  const trimmedLabel = label.trim()
  if (!trimmedLabel) return presets

  return presets.map((preset) => (preset.id === presetId ? { ...preset, label: trimmedLabel } : preset))
}

export function withColorOpacity(color: string, opacity: number): string {
  const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
  return `${color}${alpha.toString(16).padStart(2, '0')}`
}

export type DarkSurfaceColors = {
  raised: string
  composer: string
}

// Mix ratios toward white; the Default dark primary #242424 yields #383838 raised and #454545 composer.
const DARK_RAISED_MIX = 0.09
const DARK_COMPOSER_MIX = 0.15

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1]
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number]
}

function mixTowardWhite(channels: [number, number, number], ratio: number): string {
  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * ratio)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

export function deriveDarkSurfaceColors(backgroundPrimary: string): DarkSurfaceColors | null {
  const channels = parseHexColor(backgroundPrimary)
  if (!channels) return null
  return {
    raised: mixTowardWhite(channels, DARK_RAISED_MIX),
    composer: mixTowardWhite(channels, DARK_COMPOSER_MIX),
  }
}

/**
 * Raised and composer surfaces to set inline for a custom dark palette. Built-in dark presets and
 * light mode return null so the stylesheet surfaces apply.
 */
export function resolveDarkSurfaceOverrides(colors: InterfaceColors, theme: InterfaceTheme): DarkSurfaceColors | null {
  if (theme !== 'dark') return null
  const backgroundPrimary = colors.dark.backgroundPrimary.toLowerCase()
  const isBuiltInPreset = INTERFACE_COLOR_PRESETS.some(
    (preset) => preset.colors.dark.backgroundPrimary.toLowerCase() === backgroundPrimary
  )
  return isBuiltInPreset ? null : deriveDarkSurfaceColors(backgroundPrimary)
}
