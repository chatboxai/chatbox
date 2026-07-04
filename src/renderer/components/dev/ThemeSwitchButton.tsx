import { ActionIcon, type ActionIconProps, Tooltip } from '@mantine/core'
import { Theme } from '@shared/types'
import { IconBrightnessAuto, IconMoon, IconSun } from '@tabler/icons-react'
import { type FC, memo, useCallback } from 'react'
import { settingsStore, useTheme } from '@/stores/settingsStore'
import { ScalableIcon } from '../common/ScalableIcon'

export const ThemeSwitchButton: FC<ActionIconProps> = (props) => {
  const theme = useTheme()
  const setTheme = useCallback((t: Theme) => {
    settingsStore.setState((draft) => {
      draft.theme = t
    })
  }, [])
  const cycleTheme = () => {
    // Cycle through: Light -> Dark -> Light (skip Auto for simplicity in dev)
    if (theme === Theme.Light) {
      setTheme(Theme.Dark)
    } else {
      setTheme(Theme.Light)
    }
  }

  const getThemeIcon = () => {
    if (theme === Theme.Light) return <ScalableIcon icon={IconSun} size={20} />
    if (theme === Theme.Dark) return <ScalableIcon icon={IconMoon} size={20} />
    return <ScalableIcon icon={IconBrightnessAuto} size={20} />
  }

  const getThemeLabel = () => {
    if (theme === Theme.Light) return 'Light mode (click for Dark)'
    if (theme === Theme.Dark) return 'Dark mode (click for Light)'
    return 'Auto mode'
  }

  return (
    <Tooltip label={getThemeLabel()}>
      <ActionIcon variant="subtle" size="lg" aria-label={getThemeLabel()} onClick={cycleTheme} {...props}>
        {getThemeIcon()}
      </ActionIcon>
    </Tooltip>
  )
}

export default memo(ThemeSwitchButton)
