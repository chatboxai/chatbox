import type { Language } from '@shared/types'
import { getLanguage } from '@/stores/settingActions'

const ACCEPT_LANGUAGE_BY_APP_LANGUAGE: Record<Language, string> = {
  en: 'en-US,en;q=0.9',
  'zh-Hans': 'zh-CN,zh;q=0.9,en;q=0.8',
  'zh-Hant': 'zh-TW,zh-HK;q=0.9,zh;q=0.8,en;q=0.7',
  ja: 'ja-JP,ja;q=0.9,en;q=0.8',
  ko: 'ko-KR,ko;q=0.9,en;q=0.8',
  ru: 'ru-RU,ru;q=0.9,en;q=0.8',
  de: 'de-DE,de;q=0.9,en;q=0.8',
  fr: 'fr-FR,fr;q=0.9,en;q=0.8',
  'pt-PT': 'pt-PT,pt;q=0.9,en;q=0.8',
  es: 'es-ES,es;q=0.9,en;q=0.8',
  ar: 'ar,ar-SA;q=0.9,en;q=0.8',
  fa: 'fa-IR,fa;q=0.9,en;q=0.8',
  'it-IT': 'it-IT,it;q=0.9,en;q=0.8',
  sv: 'sv-SE,sv;q=0.9,en;q=0.8',
  'nb-NO': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
}

export function getSearchAcceptLanguage() {
  return ACCEPT_LANGUAGE_BY_APP_LANGUAGE[getLanguage()] ?? ACCEPT_LANGUAGE_BY_APP_LANGUAGE.en
}
