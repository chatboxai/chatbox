export type GoogleThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'
export type GoogleThinkingMode = 'budget' | 'level' | 'none'

export interface GoogleThinkingConfig {
  thinkingBudget?: number
  thinkingLevel?: GoogleThinkingLevel
  includeThoughts?: boolean
}

const GOOGLE_THINKING_LEVELS_BY_MODEL: Array<[RegExp, GoogleThinkingLevel[]]> = [
  // https://ai.google.dev/gemini-api/docs/generate-content/thinking
  // Only documented model families opt into minimal; other matched models start at low.
  [/^gemini-3\.?\d*-pro(?!-image)/i, ['low', 'medium', 'high']],
  [/^gemini-3\.[15]-flash-lite(?:-|$)/i, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3(?:\.[56])?-flash(?!-(lite|image))(?:-|$)/i, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3\.?\d*-flash(?:-|$)/i, ['low', 'medium', 'high']],
]

export function getGoogleThinkingMode(modelId: string): GoogleThinkingMode {
  const id = modelId.toLowerCase().split('/').at(-1) || modelId.toLowerCase()
  // Image generation models (e.g. gemini-2.5-flash-image, gemini-3-pro-image-preview)
  // reject thinkingConfig with "Thinking is not enabled for this model".
  if (id.includes('-image')) {
    return 'none'
  }

  if (id.startsWith('gemini-3')) {
    return 'level'
  }

  if (id.startsWith('gemini-2.5')) {
    return 'budget'
  }

  return 'none'
}

// Gemini 2.5 Pro enforces a minimum thinking budget (128): thinkingBudget: 0 is
// rejected upstream, so thinking cannot be explicitly disabled for these models.
const GOOGLE_NO_DISABLE_MODELS = [/(?:^|\/)gemini-2\.5[\w.-]*-pro/i]

export function canDisableGoogleThinking(modelId: string): boolean {
  const normalizedModelId = modelId.split('/').at(-1) || modelId
  return !GOOGLE_NO_DISABLE_MODELS.some((pattern) => pattern.test(normalizedModelId))
}

export function getSupportedGoogleThinkingLevels(modelId: string): GoogleThinkingLevel[] {
  if (getGoogleThinkingMode(modelId) !== 'level') {
    return []
  }

  const normalizedModelId = modelId.split('/').at(-1) || modelId
  const match = GOOGLE_THINKING_LEVELS_BY_MODEL.find(([pattern]) => pattern.test(normalizedModelId))

  return match?.[1] || []
}

export function getDefaultGoogleThinkingLevel(modelId: string): GoogleThinkingLevel | undefined {
  const supportedLevels = getSupportedGoogleThinkingLevels(modelId)

  return supportedLevels.at(-1)
}

export function normalizeGoogleThinkingLevel(
  modelId: string,
  thinkingLevel: GoogleThinkingLevel | undefined
): GoogleThinkingLevel | undefined {
  if (thinkingLevel !== 'minimal') {
    return thinkingLevel
  }

  return getSupportedGoogleThinkingLevels(modelId).at(0) ?? thinkingLevel
}

export function normalizeGoogleThinkingConfig(
  modelId: string,
  thinkingConfig?: GoogleThinkingConfig
): GoogleThinkingConfig | undefined {
  const mode = getGoogleThinkingMode(modelId)

  if (!thinkingConfig) {
    if (mode === 'level') {
      const defaultLevel = getDefaultGoogleThinkingLevel(modelId)
      return defaultLevel ? { thinkingLevel: defaultLevel } : undefined
    }
    return undefined
  }

  if (mode === 'budget') {
    return {
      ...(thinkingConfig.thinkingBudget !== undefined ? { thinkingBudget: thinkingConfig.thinkingBudget } : {}),
      ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
    }
  }

  if (mode === 'level') {
    const supportedLevels = getSupportedGoogleThinkingLevels(modelId)

    // Strip stale levels for Gemini 3 models outside the supported families.
    if (supportedLevels.length === 0) {
      return thinkingConfig.includeThoughts !== undefined
        ? { includeThoughts: thinkingConfig.includeThoughts }
        : undefined
    }

    const thinkingLevel = normalizeGoogleThinkingLevel(modelId, thinkingConfig.thinkingLevel)
    const effectiveLevel =
      thinkingLevel && supportedLevels.includes(thinkingLevel) ? thinkingLevel : supportedLevels.at(-1)

    return {
      ...(effectiveLevel ? { thinkingLevel: effectiveLevel } : {}),
      ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
    }
  }

  // Mode 'none': the model does not support thinking, never send a thinkingConfig.
  return undefined
}
