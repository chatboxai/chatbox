import type { ProviderSettings, Settings } from '@shared/types'

export type ProviderSettingsUpdate =
  | Partial<ProviderSettings>
  | ((prev: ProviderSettings | undefined) => Partial<ProviderSettings>)

export function mergeProviderSettings(
  currentSettings: Pick<Settings, 'providers'>,
  providerId: string,
  update: ProviderSettingsUpdate
): Pick<Settings, 'providers'> {
  const currentProviderSettings = currentSettings.providers?.[providerId]
  const nextProviderSettings = typeof update === 'function' ? update(currentProviderSettings) : update

  return {
    providers: {
      ...(currentSettings.providers || {}),
      [providerId]: {
        ...(currentProviderSettings || {}),
        ...nextProviderSettings,
      },
    },
  }
}
