import type { Language } from '../../shared/types'

export const languageNameMap: Record<Language, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский', // Russian
  de: 'Deutsch', // German
  fr: 'Français', // French
  'pt-PT': 'Português', // Portuguese
  es: 'Español', // Spanish
  ar: 'العربية', // Arabic
  fa: 'فارسی', // Persian
  'it-IT': 'Italiano', // Italian
  sv: 'Svenska', // Swedish 瑞典语
  'nb-NO': 'Norsk', // Norwegian 挪威语
}

export const languages = Array.from(Object.keys(languageNameMap)) as Language[]
