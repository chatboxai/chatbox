// Translation package - stub for open-source edition
// In the pro edition, this provides AI-powered translation
// In the open-source edition, we return the original text

export interface TranslateOptions {
  sourceLang?: string
  targetLang?: string
}

/**
 * Translate texts - stub implementation
 * In open-source edition, returns original texts unchanged
 */
export async function translateTexts(
  texts: string[],
  _targetLang: string,
  _options?: TranslateOptions
): Promise<string[]> {
  // Stub: return original texts
  return texts
}

/**
 * Check if translation is available
 */
export function isTranslationAvailable(): boolean {
  return false
}
