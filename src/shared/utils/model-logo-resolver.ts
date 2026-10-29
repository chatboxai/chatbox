import { PROVIDER_ICON_ALIASES } from '../constants/provider-icons'
import { type ModelBrand, matchModelBrand } from './model-logo-patterns'

const modelBrandLogos: Record<ModelBrand, { iconId: string; providerId?: string }> = {
  openai: { iconId: 'openai', providerId: 'openai' },
  claude: { iconId: 'claude', providerId: 'claude' },
  gemini: { iconId: 'gemini', providerId: 'gemini' },
  deepseek: { iconId: 'deepseek', providerId: 'deepseek' },
  qwen: { iconId: 'qwen', providerId: 'qwen' },
  meta: { iconId: 'meta' },
  mistral: { iconId: 'mistral-ai', providerId: 'mistral-ai' },
  moonshot: { iconId: 'moonshot', providerId: 'moonshot' },
  kimi: { iconId: 'kimi', providerId: 'moonshot' },
  chatglm: { iconId: 'chatglm-6b', providerId: 'chatglm-6b' },
  zhipu: { iconId: 'zhipu', providerId: 'chatglm-6b' },
  doubao: { iconId: 'doubao', providerId: 'volcengine' },
  baichuan: { iconId: 'baichuan' },
  yi: { iconId: 'yi' },
  hunyuan: { iconId: 'tencent-hunyuan', providerId: 'tencent-hunyuan' },
  minimax: { iconId: 'minimax', providerId: 'minimax' },
  stepfun: { iconId: 'stepfun' },
  cohere: { iconId: 'cohere' },
  grok: { iconId: 'xAI', providerId: 'xAI' },
  perplexity: { iconId: 'perplexity', providerId: 'perplexity' },
  xiaomi: { iconId: 'xiaomi', providerId: 'xiaomi-mimo' },
  longcat: { iconId: 'longcat', providerId: 'longcat' },
}

export function resolveProviderIconId(providerId: string): string {
  return PROVIDER_ICON_ALIASES[providerId] ?? providerId
}

export function resolveModelLogoProviderId(modelId: string, providerId: string): string {
  const brand = matchModelBrand(modelId)
  return brand ? modelBrandLogos[brand].iconId : providerId
}

export function hasDistinctModelAndProviderLogos(modelId: string, providerId: string): boolean {
  const brand = matchModelBrand(modelId)
  if (!brand) return false
  const brandProvider = modelBrandLogos[brand].providerId
  return !brandProvider || resolveProviderIconId(brandProvider) !== resolveProviderIconId(providerId)
}
