export type GoogleThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'
export type GoogleThinkingMode = 'budget' | 'level' | 'none'

export interface GoogleThinkingConfig {
  thinkingBudget?: number
  thinkingLevel?: GoogleThinkingLevel
  includeThoughts?: boolean
}

const GOOGLE_THINKING_LEVELS_BY_MODEL: Array<[RegExp, GoogleThinkingLevel[]]> = [
  // Official Gemini thinking docs cover Gemini 3.1 Pro, Gemini 3.1 Flash-Lite, and Gemini 3 Flash.
  // The AI SDK provider docs additionally document Gemini 3 Pro as supporting low/high.
  [/^gemini-3\.1-pro/i, ['low', 'medium', 'high']],
  [/^gemini-3-pro/i, ['low', 'high']],
  [/^gemini-3\.1-flash-lite/i, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3-flash/i, ['minimal', 'low', 'medium', 'high']],
]

export function getGoogleThinkingMode(modelId: string): GoogleThinkingMode {
  if (modelId.startsWith('gemini-3')) {
    return 'level'
  }

  if (modelId.startsWith('gemini-2.5')) {
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
  if (!thinkingConfig) {
    return undefined
  }

  const mode = getGoogleThinkingMode(modelId)

  if (mode === 'budget') {
    return {
      ...(thinkingConfig.thinkingBudget !== undefined ? { thinkingBudget: thinkingConfig.thinkingBudget } : {}),
      ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
    }
  }

  if (mode === 'level') {
    const supportedLevels = getSupportedGoogleThinkingLevels(modelId)
    const thinkingLevel = thinkingConfig.thinkingLevel

    if (thinkingLevel && (supportedLevels.length === 0 || supportedLevels.includes(thinkingLevel))) {
      return {
        thinkingLevel,
        ...(thinkingConfig.includeThoughts !== undefined ? { includeThoughts: thinkingConfig.includeThoughts } : {}),
      }
    }

    // Drop legacy Gemini 3 thinking budgets instead of guessing a level. If the user
    // has not explicitly selected a level, we let the Google API fall back to the
    // model's documented default level.
    return thinkingConfig.includeThoughts !== undefined
      ? { includeThoughts: thinkingConfig.includeThoughts }
      : undefined
  }

  return thinkingConfig
}
