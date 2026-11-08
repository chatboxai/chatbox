import { Avatar, type AvatarProps, type PolymorphicComponentProps, useComputedColorScheme } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types/provider'
import {
  type AssistantAvatarSource,
  getProviderAvatarDataUri,
  getProviderAvatarOutline,
  resolveAssistantAvatar,
} from '@chatbox/core/session/assistant-avatar'
import { IconMessageCircle, IconPhoto, IconSettingsFilled, IconUser } from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { getProviderIconSrc } from '@/utils/providerIconSrc'
import { ImageInStorage } from '../Image'
import Robot from '../icons/Robot'
import { ScalableIcon } from './ScalableIcon'

export type SystemAvatarProps = {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
  sessionType?: 'chat' | 'picture' | 'guide'
} & PolymorphicComponentProps<'div', AvatarProps>

export const SystemAvatar: FC<SystemAvatarProps> = ({ size = 'md', className, ...avatarProps }) => {
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
  sessionType?: 'chat' | 'picture' | 'guide'
  /** The provider that generated the message; its round icon replaces the default avatar. */
  aiProvider?: string
} & PolymorphicComponentProps<'div', AvatarProps>

// 优先级: avatarKey > picUrl > defaultAssistantAvatarKey > aiProvider > sessionType
export const AssistantAvatar: FC<AssistantAvatarProps> = ({
  size = 'md',
  type = 'assistant',
  avatarKey,
  picUrl,
  sessionType,
  aiProvider,
  className,
  ...avatarProps
}) => {
  const realSize = typeof size === 'number' ? size : { xs: 18, sm: 20, md: 28, lg: 32, xl: 36 }[size]
  const iconSize = Math.ceil(realSize / 2) + 2
  const defaultAssistantAvatarKey = useSettingsStore((s) => s.defaultAssistantAvatarKey)
  const customProviders = useSettingsStore((s) => s.customProviders)
  const colorScheme = useComputedColorScheme('light')
  const [failedImageUrl, setFailedImageUrl] = useState<string>()
  const resolved = resolveAssistantAvatar({
    assistantAvatarKey: avatarKey,
    picUrl,
    defaultAssistantAvatarKey,
    aiProvider,
    customProviders,
  })
  // An image URL that fails to load (e.g. a stale custom provider icon) shows the default avatar instead.
  const source: AssistantAvatarSource =
    resolved.type === 'image' && resolved.url === failedImageUrl ? { type: 'default' } : resolved
  // A custom provider icon fills the circle; session pictures keep the theme's `contain` fit.
  const isProviderImage = source.type === 'image' && !picUrl
  const providerOutline = source.type === 'provider' ? getProviderAvatarOutline(source.icon.bg, colorScheme) : undefined
  return (
    <Avatar
      size={realSize}
      radius={avatarKey || picUrl || type !== 'chat' ? realSize / 2 : 0}
      bd={0}
      className={clsx('relative overflow-hidden', avatarProps.onClick ? 'cursor-pointer' : '', className)}
      classNames={{
        placeholder: 'border-0 bg-transparent flex flex-row items-center justify-center text-inherit',
      }}
      src={source.type === 'image' ? source.url : undefined}
      styles={isProviderImage ? { image: { objectFit: 'cover' } } : undefined}
      imageProps={{ onError: () => source.type === 'image' && setFailedImageUrl(source.url) }}
      bg={
        source.type !== 'default' || type === 'chat'
          ? undefined
          : sessionType === 'picture'
            ? 'violet'
            : 'chatbox-brand'
      }
      color={type === 'chat' ? 'chatbox-primary' : 'white'}
      {...avatarProps}
    >
      {source.type === 'storage' ? (
        <ImageInStorage storageKey={source.key} className="object-cover object-center w-full h-full" />
      ) : source.type === 'provider' ? (
        <>
          <img src={getProviderAvatarDataUri(source.icon)} alt="" className="w-full h-full" />
          {providerOutline && (
            <span
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ boxShadow: `inset 0 0 0 1px ${providerOutline}` }}
            />
          )}
        </>
      ) : source.type === 'chatbox-ai' ? (
        <img src={getProviderIconSrc(ModelProviderEnum.ChatboxAI)} alt="" className="object-cover w-full h-full" />
      ) : source.type === 'default' ? (
        sessionType === 'picture' ? (
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
