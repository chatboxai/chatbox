import { Image, useComputedColorScheme } from '@mantine/core'
import { type ModelProvider, ModelProviderEnum } from '@shared/types'
import { renderModelIcon } from '@/utils/modelLogo'
import { getProviderIconSrc } from '@/utils/providerIconSrc'
import ProviderIcon from './ProviderIcon'

interface ModelIconProps {
  modelId: string
  providerId?: ModelProvider | string
  size?: number
  className?: string
}

/**
 * Display a model-specific icon with fallback to provider icon.
 * Uses @lobehub/icons for model-specific icons with proper dark mode support.
 *
 * Priority:
 * 1. Model-specific icon (based on modelId)
 * 2. Provider icon (if providerId is provided)
 * 3. First letter avatar (as final fallback)
 */
export function ModelIcon({ modelId, providerId, size = 16, className }: ModelIconProps) {
  const colorScheme = useComputedColorScheme('light')
  const isDarkMode = colorScheme === 'dark'

  const icon = renderModelIcon(modelId, size, isDarkMode)

  if (icon) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
    )
  }

  // Chatbox AI's own models use the monochrome brand icon rather than the
  // orange provider image used in settings and other provider-level surfaces.
  if (providerId === ModelProviderEnum.ChatboxAI && modelId.startsWith('chatboxai-')) {
    return <ProviderIcon provider={providerId} size={size} className={className} />
  }

  // Fallback to bundled provider PNG resources if no model-specific icon.
  const providerIconSrc = providerId ? getProviderIconSrc(providerId) : undefined
  if (providerIconSrc) {
    return <Image w={size} h={size} src={providerIconSrc} className={className} alt={`${providerId} image icon`} />
  }

  // Fallback to ProviderIcon if no provider PNG exists.
  if (providerId) {
    return <ProviderIcon provider={providerId} size={size} className={className} />
  }

  // Final fallback: first letter avatar
  const firstLetter = modelId.charAt(0).toUpperCase()
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: 'var(--mantine-color-gray-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.6,
        fontWeight: 500,
        color: 'var(--mantine-color-gray-7)',
      }}
    >
      {firstLetter}
    </div>
  )
}
