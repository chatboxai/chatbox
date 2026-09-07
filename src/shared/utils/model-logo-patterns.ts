/**
 * Model-id brand detection shared by the renderer (@lobehub icon components,
 * utils/modelLogo.tsx) and the native app (bundled PNGs, components/ModelLogo).
 * Order matters — more specific patterns come first. Each platform maps the
 * brand key to its own asset; brands without an asset fall back to the
 * provider icon.
 */
export type ModelBrand =
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'meta'
  | 'mistral'
  | 'moonshot'
  | 'kimi'
  | 'chatglm'
  | 'zhipu'
  | 'doubao'
  | 'baichuan'
  | 'yi'
  | 'hunyuan'
  | 'minimax'
  | 'stepfun'
  | 'cohere'
  | 'grok'
  | 'perplexity'
  | 'xiaomi'
  | 'longcat'

export const MODEL_BRAND_PATTERNS: ReadonlyArray<readonly [RegExp, ModelBrand]> = [
  [/\b(o1|o3|o4|gpt|chatgpt)/i, 'openai'],
  [/claude/i, 'claude'],
  [/gemini/i, 'gemini'],
  [/deepseek/i, 'deepseek'],
  [/qwen|qwq|qvq/i, 'qwen'],
  [/llama/i, 'meta'],
  [/mistral|mixtral|codestral|ministral|magistral/i, 'mistral'],
  [/moonshot/i, 'moonshot'],
  [/kimi/i, 'kimi'],
  [/glm/i, 'chatglm'],
  [/zhipu/i, 'zhipu'],
  [/doubao|ep-202/i, 'doubao'],
  [/baichuan/i, 'baichuan'],
  [/yi-/i, 'yi'],
  [/hunyuan|(?:^|[/:_.-])hy4(?:$|[/:_.-])/i, 'hunyuan'],
  [/minimax|abab/i, 'minimax'],
  [/step-/i, 'stepfun'],
  [/cohere|command-r/i, 'cohere'],
  [/grok/i, 'grok'],
  [/perplexity|sonar/i, 'perplexity'],
  [/(^|[/:_-])(mimo|xiaomi)([/:_-]|$)/i, 'xiaomi'],
  [/longcat/i, 'longcat'],
]

export function matchModelBrand(modelId: string): ModelBrand | undefined {
  if (!modelId) return undefined
  return MODEL_BRAND_PATTERNS.find(([pattern]) => pattern.test(modelId))?.[1]
}
