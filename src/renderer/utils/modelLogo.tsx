// Import only Mono and Color components to avoid @lobehub/ui dependency
import BaichuanColor from '@lobehub/icons/es/Baichuan/components/Color'
import ChatGLMColor from '@lobehub/icons/es/ChatGLM/components/Color'
import ClaudeColor from '@lobehub/icons/es/Claude/components/Color'
import CohereColor from '@lobehub/icons/es/Cohere/components/Color'
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color'
import DoubaoColor from '@lobehub/icons/es/Doubao/components/Color'
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color'
import GrokMono from '@lobehub/icons/es/Grok/components/Mono'
import HunyuanColor from '@lobehub/icons/es/Hunyuan/components/Color'
import KimiMono from '@lobehub/icons/es/Kimi/components/Mono'
import LongCatColor from '@lobehub/icons/es/LongCat/components/Color'
import MetaColor from '@lobehub/icons/es/Meta/components/Color'
import MinimaxColor from '@lobehub/icons/es/Minimax/components/Color'
import MistralColor from '@lobehub/icons/es/Mistral/components/Color'
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono'
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono'
import PerplexityColor from '@lobehub/icons/es/Perplexity/components/Color'
import QwenColor from '@lobehub/icons/es/Qwen/components/Color'
import StepfunColor from '@lobehub/icons/es/Stepfun/components/Color'
import XiaomiMiMoMono from '@lobehub/icons/es/XiaomiMiMo/components/Mono'
import YiColor from '@lobehub/icons/es/Yi/components/Color'
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color'
import { type ModelBrand, matchModelBrand } from '@shared/utils/model-logo-patterns'
import type { ComponentType, ReactElement } from 'react'

interface IconProps {
  size?: number | string
  style?: React.CSSProperties
  className?: string
}

type IconComponent = ComponentType<IconProps>

interface ModelLogoConfig {
  icon: IconComponent
  darkModeColor?: string // Color to use in dark mode for mono icons
}

/**
 * Brand detection lives in @shared/utils/model-logo-patterns (shared with the
 * native app); this map only binds each brand to its lobehub icon component.
 */
const BRAND_ICONS: Record<ModelBrand, ModelLogoConfig> = {
  openai: { icon: OpenAIMono, darkModeColor: '#fff' },
  claude: { icon: ClaudeColor },
  gemini: { icon: GeminiColor },
  deepseek: { icon: DeepSeekColor },
  qwen: { icon: QwenColor },
  meta: { icon: MetaColor },
  mistral: { icon: MistralColor },
  moonshot: { icon: MoonshotMono, darkModeColor: '#fff' },
  kimi: { icon: KimiMono, darkModeColor: '#fff' },
  chatglm: { icon: ChatGLMColor },
  zhipu: { icon: ZhipuColor },
  doubao: { icon: DoubaoColor },
  baichuan: { icon: BaichuanColor },
  yi: { icon: YiColor },
  hunyuan: { icon: HunyuanColor },
  minimax: { icon: MinimaxColor },
  stepfun: { icon: StepfunColor },
  cohere: { icon: CohereColor },
  grok: { icon: GrokMono, darkModeColor: '#fff' },
  perplexity: { icon: PerplexityColor },
  xiaomi: { icon: XiaomiMiMoMono, darkModeColor: '#fff' },
  longcat: { icon: LongCatColor },
}

/**
 * Get the model logo configuration for a model based on its ID.
 *
 * @param modelId - The model ID to match against
 * @returns The config if found, undefined otherwise
 */
export function getModelLogoConfig(modelId: string): ModelLogoConfig | undefined {
  const brand = matchModelBrand(modelId)
  return brand ? BRAND_ICONS[brand] : undefined
}

/**
 * Render a model icon as a React element.
 *
 * @param modelId - The model ID to match against
 * @param size - Icon size (default: 16)
 * @param isDarkMode - Whether dark mode is active
 * @returns The rendered icon element or undefined
 */
export function renderModelIcon(
  modelId: string,
  size: number = 16,
  isDarkMode: boolean = false
): ReactElement | undefined {
  const config = getModelLogoConfig(modelId)
  if (!config) return undefined

  const { icon: Icon, darkModeColor } = config

  // For mono icons, apply dark mode color if needed
  if (darkModeColor && isDarkMode) {
    return <Icon size={size} style={{ color: darkModeColor }} />
  }

  return <Icon size={size} />
}
