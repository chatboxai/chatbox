// Stub for translation package.
// The full implementation exists only in the official (non-OSS) edition
// and calls a proprietary translation service.
// In the OSS build, translation is silently unavailable — callers already
// handle the null return and catch any thrown errors.

export async function translateTexts(
  texts: string[],
  _targetLang: string,
  _options?: { sourceLang?: string }
): Promise<(string | null)[]> {
  return texts.map(() => null)
}
