import { ActionIcon, type ActionIconProps, Flex, type FlexProps, Tooltip } from '@mantine/core'
import { IconMinus, type IconProps, IconSquare, IconSquares, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { type FC, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useWindowMaximized } from '@/hooks/useWindowMaximized'
import platform from '@/platform'
import { ScalableIcon } from './ScalableIcon'

export const WindowControls: FC<FlexProps> = ({ className, ...otherProps }) => {
  const { t } = useTranslation()
  const windowMaximized = useWindowMaximized()
  const platformType = useAtomValue(platformTypeAtom)
  return platformType === 'win32' || platformType === 'linux' ? (
    <Flex align="center" className={clsx('controls self-start', className)} {...otherProps}>
      <ControlButton label={t('Minimize')} icon={IconMinus} onClick={() => platform.minimize()} />
      {!windowMaximized ? (
        <ControlButton label={t('Maximize')} icon={IconSquare} onClick={() => platform.maximize()} />
      ) : (
        <ControlButton label={t('Restore')} icon={IconSquares} onClick={() => platform.unmaximize()} />
      )}
      <ControlButton
        label={t('Close')}
        icon={IconX}
        className="hover:bg-chatbox-tint-error"
        onClick={() => platform.closeWindow()}
      />
    </Flex>
  ) : null
}

export default memo(WindowControls)

type ControlButtonProps = {
  label?: string
  icon: React.ElementType<IconProps>
  onClick?(): void
} & ActionIconProps

const ControlButton: FC<ControlButtonProps> = ({ label, icon, onClick, ...props }) => {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" size={44} radius={0} color="chatbox-primary" onClick={onClick} {...props}>
        <ScalableIcon icon={icon} size={16} strokeWidth={1.5} />
      </ActionIcon>
    </Tooltip>
  )
}
