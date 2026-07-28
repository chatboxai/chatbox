/// <reference types="vite/client" />

import { Image } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import ProviderIcon from '@/components/icons/ProviderIcon'

// Use Vite's import.meta.glob to dynamically import all PNG files
// Vite handles import.meta.glob at build time, even though TypeScript doesn't recognize it with commonjs module setting
// @ts-ignore - import.meta.glob is a Vite feature
const iconsModules = import.meta.glob<{ default: string }>('../../../static/icons/providers/*.png', { eager: true })

const providerIconMap = new Map<string, string>(
  Object.entries(iconsModules).map(([path, module]) => {
    const filename = path.split('/').pop() || ''
    const name = filename.replace('.png', '')
    return [name, module.default]
  })
)

const PROVIDER_ICON_ALIASES: Record<string, string> = {
  [ModelProviderEnum.QwenPortal]: ModelProviderEnum.Qwen,
  [ModelProviderEnum.MiniMaxCN]: ModelProviderEnum.MiniMax,
}

export const FEATURED_PROVIDER_IDS: string[] = [
  ModelProviderEnum.OpenAI,
  ModelProviderEnum.Claude,
  ModelProviderEnum.Gemini,
  ModelProviderEnum.SiliconFlow,
  ModelProviderEnum.DeepSeek,
  ModelProviderEnum.OpenRouter,
  ModelProviderEnum.Modelsell,
  ModelProviderEnum.Ollama,
]

export function getProviderIconSrc(providerId: string): string | undefined {
  return providerIconMap.get(providerId) || providerIconMap.get(PROVIDER_ICON_ALIASES[providerId] || '')
}

export function ProviderIconImage({ providerId, size = 32 }: { providerId: string; size?: number }) {
  const iconSrc = getProviderIconSrc(providerId)
  return iconSrc ? (
    <Image w={size} h={size} src={iconSrc} alt={providerId} />
  ) : (
    <ProviderIcon provider={providerId} size={size} />
  )
}
