import { ActionIcon, type ActionIconProps, Box, Flex, type FlexProps } from '@mantine/core'
import { IconMinus, type IconProps, IconSquare, IconSquares, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtomValue } from 'jotai'
import { type FC, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useWindowMaximized } from '@/hooks/useWindowMaximized'
import platform from '@/platform'
import { ScalableIcon } from '../common/ScalableIcon'

/**
 * Minimize / maximize / close for frameless windows on Windows and Linux.
 * With `height`, the buttons fill a title bar of that height edge to edge behind a divider;
 * without it they keep the compact size used by small-screen page headers.
 */
export const WindowControls: FC<FlexProps & { height?: number }> = ({ className, height, ...otherProps }) => {
  const { t } = useTranslation()
  const windowMaximized = useWindowMaximized()
  const platformType = useAtomValue(platformTypeAtom)

  if (platformType !== 'win32' && platformType !== 'linux') {
    return null
  }

  const controlRadius = 0
  const buttonSize = height ? { w: 46, h: height } : { size: 40 }

  const minimizeButton = (
    <ControlButton
      label={t('Minimize') ?? ''}
      icon={IconMinus}
      radius={controlRadius}
      {...buttonSize}
      onClick={() => platform.minimize()}
    />
  )
  const maximizeButton = !windowMaximized ? (
    <ControlButton
      label={t('Maximize') ?? ''}
      icon={IconSquare}
      radius={controlRadius}
      {...buttonSize}
      onClick={() => platform.maximize()}
    />
  ) : (
    <ControlButton
      label={t('Restore') ?? ''}
      icon={IconSquares}
      radius={controlRadius}
      {...buttonSize}
      onClick={() => platform.unmaximize()}
    />
  )
  const closeButton = (
    <ControlButton
      label={t('Close') ?? ''}
      icon={IconX}
      radius={controlRadius}
      {...buttonSize}
      className="hover:bg-chatbox-tint-error"
      onClick={() => platform.closeWindow()}
    />
  )

  return (
    <Flex
      align="center"
      h={height}
      className={clsx('controls flex-none', !height && 'self-start', className)}
      {...otherProps}
    >
      {height && <Box w={1} h={16} mr={4} className="bg-chatbox-border-primary" />}
      {minimizeButton}
      {maximizeButton}
      {closeButton}
    </Flex>
  )
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
      <ActionIcon variant="subtle" radius={0} color="chatbox-primary" aria-label={label} onClick={onClick} {...props}>
        <ScalableIcon icon={icon} size={16} strokeWidth={1.5} />
      </ActionIcon>
    </Tooltip>
  )
}
