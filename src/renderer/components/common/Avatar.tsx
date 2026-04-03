import { Avatar, type AvatarProps, type PolymorphicComponentProps } from '@mantine/core'
import { IconMessageCircle, IconPhoto, IconSettingsFilled, IconUser } from '@tabler/icons-react'
import clsx from 'clsx'
import type { FC } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { ImageInStorage } from '../Image'
import Robot from '../icons/Robot'
import { ScalableIcon } from './ScalableIcon'

export type SystemAvatarProps = {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
  sessionType?: 'chat' | 'picture'
} & PolymorphicComponentProps<'div', AvatarProps>

export const SystemAvatar: FC<SystemAvatarProps> = ({ size = 'md', sessionType: _sessionType, className, ...avatarProps }) => {
  const realSize = typeof size === 'number' ? size : { xs: 18, sm: 20, md: 28, lg: 32, xl: 36 }[size]
  const iconSize = Math.ceil(realSize / 2) + 2

  return (
    <Avatar
      size={realSize}
      radius={realSize / 2}
      bd={0}
      className={clsx('overflow-hidden', avatarProps.onClick ? 'cursor-pointer' : '', className)}
      classNames={{
        placeholder: 'border-0 bg-transparent !text-white flex flex-row items-center justify-center',
      }}
      bg={'chatbox-warning'}
      {...avatarProps}
    >
      <ScalableIcon icon={IconSettingsFilled} size={iconSize} className="!text-inherit" />
    </Avatar>
  )
}

export type UserAvatarProps = {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
  avatarKey?: string
} & PolymorphicComponentProps<'div', AvatarProps>

export const UserAvatar: FC<UserAvatarProps> = ({ size = 'md', avatarKey, className, ...avatarProps }) => {
  const realSize = typeof size === 'number' ? size : { xs: 18, sm: 20, md: 28, lg: 32, xl: 36 }[size]
  const iconSize = Math.ceil(realSize / 2) + 2

  return (
    <Avatar
      size={realSize}
      radius={realSize / 2}
      bd={0}
      className={clsx('overflow-hidden', avatarProps.onClick ? 'cursor-pointer' : '', className)}
      classNames={{
        placeholder: 'border-0 bg-transparent !text-white flex flex-row items-center justify-center',
      }}
      bg={avatarKey ? undefined : 'chatbox-tertiary'}
      {...avatarProps}
    >
      {avatarKey ? (
        <ImageInStorage storageKey={avatarKey} className="object-cover object-center w-full h-full" />
      ) : (
        <ScalableIcon icon={IconUser} size={iconSize} className="!text-inherit" />
      )}
    </Avatar>
  )
}

export type AssistantAvatarProps = {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
  type?: 'assistant' | 'chat'
  avatarKey?: string
  picUrl?: string
  sessionType?: 'chat' | 'picture'
} & PolymorphicComponentProps<'div', AvatarProps>

// 优先级: avatarKey > picUrl > defaultAssistantAvatarKey > sessionType
export const AssistantAvatar: FC<AssistantAvatarProps> = ({
  size = 'md',
  type = 'assistant',
  avatarKey,
  picUrl,
  sessionType,
  className,
  ...avatarProps
}) => {
  const realSize = typeof size === 'number' ? size : { xs: 18, sm: 20, md: 28, lg: 32, xl: 36 }[size]
  const iconSize = Math.ceil(realSize / 2) + 2
  const defaultAssistantAvatarKey = useSettingsStore((s) => s.defaultAssistantAvatarKey)
  return (
    <Avatar
      size={realSize}
      radius={avatarKey || picUrl || type !== 'chat' ? realSize / 2 : 0}
      bd={0}
      className={clsx('overflow-hidden', avatarProps.onClick ? 'cursor-pointer' : '', className)}
      classNames={{
        placeholder: 'border-0 bg-transparent flex flex-row items-center justify-center text-inherit',
      }}
      src={!avatarKey ? picUrl : undefined}
      bg={
        avatarKey || picUrl || defaultAssistantAvatarKey
          ? undefined
          : type === 'chat'
            ? undefined
            : sessionType === 'picture'
              ? 'violet'
              : 'chatbox-brand'
      }
      color={type === 'chat' ? 'chatbox-primary' : 'white'}
      {...avatarProps}
    >
      {avatarKey ? (
        <ImageInStorage storageKey={avatarKey} className="object-cover object-center w-full h-full" />
      ) : !picUrl ? (
        defaultAssistantAvatarKey ? (
          <ImageInStorage storageKey={defaultAssistantAvatarKey} className="object-cover object-center w-full h-full" />
        ) : sessionType === 'picture' ? (
          type === 'chat' ? (
            <ScalableIcon icon={IconPhoto} size={realSize} className="!text-inherit" strokeWidth={1.5} />
          ) : (
            <ScalableIcon icon={IconPhoto} size={iconSize} className="!text-white" strokeWidth={1.5} />
          )
        ) : type === 'chat' ? (
          <ScalableIcon icon={IconMessageCircle} size={realSize} className="!text-inherit" strokeWidth={1.5} />
        ) : (
          <ScalableIcon icon={Robot} size={iconSize} className="!text-white" strokeWidth={1.5} />
        )
      ) : null}
    </Avatar>
  )
}
