import { ProviderSettings, Settings } from 'src/shared/types'
import { useAtom } from 'jotai'
import { useImmerAtom } from 'jotai-immer'
import { useCallback } from 'react'
import { settingsAtom } from '@/stores/atoms'

export const useSettings = () => {
  const [settings, _setSettings] = useAtom(settingsAtom)

  const setSettings = useCallback((update: Partial<Settings> | ((prev: Settings) => Partial<Settings>)) => {
    _setSettings((prev) => {
      const val = typeof update === 'function' ? update(prev) : update
      return {
        ...prev,
        ...val,
      }
    })
  }, [])

  return {
    settings,
    setSettings,
  }
}

export const useProviderSettings = (providerId: string) => {
  const { settings, setSettings } = useSettings()

  const providerSettings = settings.providers?.[providerId]

  const setProviderSettings = (
    val: Partial<ProviderSettings> | ((prev: ProviderSettings | undefined) => Partial<ProviderSettings>)
  ) => {
    setSettings((currentSettings) => {
      const currentProviderSettings = currentSettings.providers?.[providerId] || {}
      const newProviderSettings = typeof val === 'function' ? val(currentProviderSettings) : val

      return {
        providers: {
          ...(currentSettings.providers || {}),
          [providerId]: {
            ...currentProviderSettings,
            ...newProviderSettings,
          },
        },
      }
    })
  }

  return {
    providerSettings,
    setProviderSettings,
  }
}

// https://jotai.org/docs/extensions/immer
export const useImmerSettings = () => {
  return useImmerAtom(settingsAtom)
}
