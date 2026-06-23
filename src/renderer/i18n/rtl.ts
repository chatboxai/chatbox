import type { Language } from '@shared/types'

const RTL_LANGUAGES: ReadonlySet<Language> = new Set(['ar', 'fa'])

export function isRtlLanguage(language: Language): boolean {
  return RTL_LANGUAGES.has(language)
}
