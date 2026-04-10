import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { authErrorOverrides } from './auth-error-overrides'
import changelogEn from './changelogs/changelog_en'
import changelogZhHans from './changelogs/changelog_zh_Hans'
import changelogZhHant from './changelogs/changelog_zh_Hant'
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

i18n.use(initReactI18next).init({
  resources: {
    'zh-Hans': {
      translation: { ...zhHans, ...authErrorOverrides['zh-Hans'] },
    },
    'zh-Hant': {
      translation: { ...zhHant, ...authErrorOverrides['zh-Hant'] },
    },
    en: {
      translation: { ...en, ...authErrorOverrides.en },
    },
    ja: {
      translation: ja,
    },
    ko: {
      translation: ko,
    },
    ru: {
      translation: ru,
    },
    de: {
      translation: de,
    },
    fr: {
      translation: fr,
    },
    'pt-PT': {
      translation: ptPT,
    },
    es: {
      translation: es,
    },
    ar: {
      translation: ar,
    },
    'it-IT': {
      translation: itIT,
    },
    sv: {
      translation: sv,
    },
    'nb-NO': {
      translation: nbNO,
    },
  },
  fallbackLng: 'en',

  interpolation: {
    escapeValue: false,
  },

  detection: {
    caches: [],
  },
})

export default i18n

export function changelog() {
  switch (i18n.language) {
    case 'zh-Hans':
      return changelogZhHans
    case 'zh-Hant':
      return changelogZhHant
    case 'en':
      return changelogEn
    default:
      return changelogEn
  }
}
