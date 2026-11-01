import { Image } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import ProviderIcon from '@/components/icons/ProviderIcon'
import { getProviderIconSrc } from '@/utils/providerIconSrc'

export const FEATURED_PROVIDER_IDS: string[] = [
  ModelProviderEnum.OpenAI,
  ModelProviderEnum.Claude,
  ModelProviderEnum.Gemini,
  ModelProviderEnum.SiliconFlow,
  ModelProviderEnum.DeepSeek,
  ModelProviderEnum.XiaomiMiMo,
  ModelProviderEnum.MiniMax,
  ModelProviderEnum.GLM,
  ModelProviderEnum.OpenRouter,
  ModelProviderEnum.Ollama,
]

export function ProviderIconImage({ providerId, size = 32 }: { providerId: string; size?: number }) {
  const iconSrc = getProviderIconSrc(providerId)
  return iconSrc ? (
    <Image w={size} h={size} src={iconSrc} alt={providerId} />
  ) : (
    <ProviderIcon provider={providerId} size={size} />
  )
}
