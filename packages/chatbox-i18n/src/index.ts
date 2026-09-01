import ar from './locales/ar/translation.json'
import de from './locales/de/translation.json'
import en from './locales/en/translation.json'
import es from './locales/es/translation.json'
import fr from './locales/fr/translation.json'
import itIT from './locales/it-IT/translation.json'
import ja from './locales/ja/translation.json'
import ko from './locales/ko/translation.json'
import nbNO from './locales/nb-NO/translation.json'
import ptPT from './locales/pt-PT/translation.json'
import ru from './locales/ru/translation.json'
import sv from './locales/sv/translation.json'
import zhHans from './locales/zh-Hans/translation.json'
import zhHant from './locales/zh-Hant/translation.json'

export type TranslationKey = keyof typeof en
export { type I18nLanguage, languageNameMap, languages, supportedLanguages } from './languages'

export const translationResources = {
  en: { translation: en },
  'zh-Hans': { translation: zhHans },
  'zh-Hant': { translation: zhHant },
  ja: { translation: ja },
  ko: { translation: ko },
  ru: { translation: ru },
  de: { translation: de },
  fr: { translation: fr },
  'pt-PT': { translation: ptPT },
  es: { translation: es },
  ar: { translation: ar },
  'it-IT': { translation: itIT },
  sv: { translation: sv },
  'nb-NO': { translation: nbNO },
} as const
