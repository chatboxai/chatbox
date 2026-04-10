export type GoogleThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'
export type GoogleThinkingMode = 'budget' | 'level' | 'none'

export interface GoogleThinkingConfig {
  thinkingBudget?: number
  thinkingLevel?: GoogleThinkingLevel
  includeThoughts?: boolean
}

const GOOGLE_THINKING_LEVELS_BY_MODEL: Array<[RegExp, GoogleThinkingLevel[]]> = [
  // Per official Gemini thinking docs:
  // - Pro models support low/medium/high (no minimal)
  // - Flash and Flash-Lite models support minimal/low/medium/high
  [/^gemini-3\.?[\d]*-pro(?!-image)/i, ['low', 'medium', 'high']],
  [/^gemini-3\.?[\d]*-flash-lite/i, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3\.?[\d]*-flash(?!-(lite|image))/i, ['minimal', 'low', 'medium', 'high']],
]

export function getGoogleThinkingMode(modelId: string): GoogleThinkingMode {
  const id = modelId.toLowerCase()
  if (id.startsWith('gemini-3')) {
    return 'level'
  }

  if (id.startsWith('gemini-2.5')) {
    return 'budget'
  }

  return 'none'
}

export function getSupportedGoogleThinkingLevels(modelId: string): GoogleThinkingLevel[] {
  if (getGoogleThinkingMode(modelId) !== 'level') {
    return []
  }

  const match = GOOGLE_THINKING_LEVELS_BY_MODEL.find(([pattern]) => pattern.test(modelId))

  return match?.[1] || []
}

export function getDefaultGoogleThinkingLevel(modelId: string): GoogleThinkingLevel | undefined {
  const supportedLevels = getSupportedGoogleThinkingLevels(modelId)

  return supportedLevels.at(-1)
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
    const thinkingLevel = thinkingConfig.thinkingLevel

    // Fix: strip thinkingLevel for Gemini 3 models not in the supported list (e.g. image models),
    // so stale levels from a previous model selection are not sent to the API.
    if (supportedLevels.length === 0) {
      return thinkingConfig.includeThoughts !== undefined
        ? { includeThoughts: thinkingConfig.includeThoughts }
        : undefined
    }

    // Use the saved level if valid, otherwise explicitly send the default ("high").
    const effectiveLevel =
      thinkingLevel && supportedLevels.includes(thinkingLevel) ? thinkingLevel : getDefaultGoogleThinkingLevel(modelId)

    return {
      ...(effectiveLevel ? { thinkingLevel: effectiveLevel } : {}),
      ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
    }
  }

  return thinkingConfig
}
