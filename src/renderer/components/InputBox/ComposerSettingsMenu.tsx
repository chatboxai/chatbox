import { Menu, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { type Icon, IconAdjustmentsHorizontal, IconArrowBackUp, IconPlus, IconSettings } from '@tabler/icons-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '../common/ScalableIcon'

type ComposerSettingsMenuProps = {
  canCreateThread: boolean
  toolbarIconSize: number
  hasSessionOverrides?: boolean
  threadActionPending?: boolean
  showRollbackThread?: boolean
  onStartNewThread?: () => void
  onRollbackThread?: () => void
  onClickSessionSettings?: () => void
}

const TRIGGER_CLASS_NAME =
  'flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--chatbox-background-tertiary)] transition-colors disabled:opacity-50'

/**
 * Small-screen composer entry. Where threads exist it groups thread actions with conversation settings
 * behind one button to save toolbar width; otherwise it opens conversation settings directly.
 */
export const ComposerSettingsMenu: FC<ComposerSettingsMenuProps> = ({
  canCreateThread,
  toolbarIconSize,
  hasSessionOverrides,
  threadActionPending,
  showRollbackThread,
  onStartNewThread,
  onRollbackThread,
  onClickSessionSettings,
}) => {
  const { t } = useTranslation()

  const triggerIcon = (TriggerIcon: Icon) => (
    <span className="relative flex">
      <TriggerIcon size={toolbarIconSize} strokeWidth={1.8} className="text-[var(--chatbox-tint-secondary)]" />
      {hasSessionOverrides && (
        <span
          data-testid={TestId.chat.sessionSettingsOverridden}
          className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-chatbox-tint-brand"
        />
      )}
    </span>
  )

  if (!canCreateThread) {
    return (
      <UnstyledButton
        data-testid={TestId.chat.sessionSettings}
        aria-label={t('Conversation Settings') || undefined}
        onClick={onClickSessionSettings}
        disabled={!onClickSessionSettings}
        className={TRIGGER_CLASS_NAME}
      >
        {triggerIcon(IconAdjustmentsHorizontal)}
      </UnstyledButton>
    )
  }

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
        <UnstyledButton aria-label={t('Conversation Settings') || undefined} className={TRIGGER_CLASS_NAME}>
          {triggerIcon(IconSettings)}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown data-testid="composer-settings-menu">
        {showRollbackThread ? (
          <Menu.Item
            data-testid={TestId.chat.rollbackThread}
            leftSection={<ScalableIcon icon={IconArrowBackUp} size={16} />}
            onClick={onRollbackThread}
          >
            {t('Rollback Thread')}
          </Menu.Item>
        ) : (
          <Menu.Item
            data-testid={TestId.chat.newThread}
            leftSection={<ScalableIcon icon={IconPlus} size={16} />}
            onClick={onStartNewThread}
            disabled={threadActionPending || !onStartNewThread}
          >
            {t('New Thread')}
          </Menu.Item>
        )}
        <Menu.Item
          data-testid={TestId.chat.sessionSettings}
          leftSection={<ScalableIcon icon={IconAdjustmentsHorizontal} size={16} />}
          onClick={onClickSessionSettings}
          disabled={!onClickSessionSettings}
        >
          {t('Conversation Settings')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
