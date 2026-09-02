import { Menu, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { IconAdjustmentsHorizontal, IconPlus, IconSettings } from '@tabler/icons-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '../common/ScalableIcon'

type ComposerSettingsMenuProps = {
  canCreateThread: boolean
  toolbarIconSize: number
  onStartNewThread?: () => void
  onClickSessionSettings?: () => void
}

export const ComposerSettingsMenu: FC<ComposerSettingsMenuProps> = ({
  canCreateThread,
  toolbarIconSize,
  onStartNewThread,
  onClickSessionSettings,
}) => {
  const { t } = useTranslation()

  return (
    <Menu
      shadow="md"
      trigger="click"
      position="top-start"
      openDelay={100}
      closeDelay={100}
      keepMounted
      middlewares={{ flip: false }}
      transitionProps={{
        transition: 'pop',
        duration: 200,
      }}
    >
      <Menu.Target>
        <UnstyledButton
          aria-label={t('Conversation Settings') || undefined}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
        >
          <IconSettings size={toolbarIconSize} strokeWidth={1.8} className="text-[var(--chatbox-tint-secondary)]" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown data-testid="composer-settings-menu">
        {canCreateThread && (
          <Menu.Item
            data-testid={TestId.chat.newThread}
            leftSection={<ScalableIcon icon={IconPlus} size={16} />}
            onClick={onStartNewThread}
          >
            {t('New Thread')}
          </Menu.Item>
        )}
        <Menu.Item
          data-testid={TestId.chat.sessionSettings}
          leftSection={<ScalableIcon icon={IconAdjustmentsHorizontal} size={16} />}
          onClick={onClickSessionSettings}
        >
          {t('Conversation Settings')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
