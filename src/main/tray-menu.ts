import type { MenuItemConstructorOptions } from 'electron'
import Locale from './locales'

export interface TrayMenuOptions {
  /** Application language, as stored in `settings.language`. */
  language?: string | null
  /** Accelerator of the "Show/Hide" entry, from `settings.shortcuts.quickToggle`. */
  quickToggleAccelerator?: string
  onToggleWindow: () => void
  onQuit: () => void
}

/**
 * Template of the tray context menu. Kept out of `main.ts` so it can be rebuilt on its own
 * (see `refreshTrayMenu`) and unit tested without an Electron runtime.
 */
export function buildTrayMenuTemplate(options: TrayMenuOptions): MenuItemConstructorOptions[] {
  const locale = new Locale(options.language)

  return [
    {
      label: locale.t('Show/Hide'),
      click: options.onToggleWindow,
      ...(options.quickToggleAccelerator
        ? // `settings.shortcuts.quickToggle` is a plain string, Electron types accelerators as a literal union
          { accelerator: options.quickToggleAccelerator as MenuItemConstructorOptions['accelerator'] }
        : {}),
    },
    {
      label: locale.t('Exit'),
      click: options.onQuit,
      accelerator: 'Command+Q',
    },
  ]
}
