import { translationResources } from '@chatbox/i18n'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { authErrorOverrides } from './auth-error-overrides'
import changelogEn from './changelogs/changelog_en'
import changelogZhHans from './changelogs/changelog_zh_Hans'
import changelogZhHant from './changelogs/changelog_zh_Hant'

i18n.use(initReactI18next).init({
  resources: {
    ...translationResources,
    'zh-Hans': {
      translation: { ...translationResources['zh-Hans'].translation, ...authErrorOverrides['zh-Hans'] },
    },
    'zh-Hant': {
      translation: { ...translationResources['zh-Hant'].translation, ...authErrorOverrides['zh-Hant'] },
    },
    en: {
      translation: { ...translationResources.en.translation, ...authErrorOverrides.en },
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
