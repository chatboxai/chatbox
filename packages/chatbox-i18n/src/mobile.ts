import { languageNameMap } from './languages'
import en from './locales/en/translation.json'
import zhHans from './locales/zh-Hans/translation.json'
import mobileEn from './mobile-locales/en/translation.json'
import mobileZhHans from './mobile-locales/zh-Hans/translation.json'

export const mobileSupportedLanguages = ['en', 'zh-Hans'] as const
export type MobileI18nLanguage = (typeof mobileSupportedLanguages)[number]

export function isMobileI18nLanguage(language: string): language is MobileI18nLanguage {
  return (mobileSupportedLanguages as readonly string[]).includes(language)
}

export const mobileLanguageNameMap: Record<MobileI18nLanguage, string> = {
  en: languageNameMap.en,
  'zh-Hans': languageNameMap['zh-Hans'],
}

export const mobileLanguages = [...mobileSupportedLanguages]

export const mobileTranslationOverlays = {
  en: mobileEn,
  'zh-Hans': mobileZhHans,
} as const

export const mobileTranslationResources = {
  en: { translation: { ...en, ...mobileTranslationOverlays.en } },
  'zh-Hans': { translation: { ...zhHans, ...mobileTranslationOverlays['zh-Hans'] } },
} as const
