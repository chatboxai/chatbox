export const supportedLanguages = [
  'en',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'ru',
  'de',
  'fr',
  'pt-PT',
  'es',
  'ar',
  'it-IT',
  'sv',
  'nb-NO',
  'tr',
] as const

export type I18nLanguage = (typeof supportedLanguages)[number]

export const languageNameMap: Record<I18nLanguage, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  de: 'Deutsch',
  fr: 'Français',
  'pt-PT': 'Português',
  es: 'Español',
  ar: 'العربية',
  'it-IT': 'Italiano',
  sv: 'Svenska',
  'nb-NO': 'Norsk',
  tr: 'Türkçe',
}

export const languages = [...supportedLanguages]
