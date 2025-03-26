import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en/translation.json'
import zhHans from './locales/zh-Hans/translation.json'
import zhHant from './locales/zh-Hant/translation.json'
import ja from './locales/ja/translation.json'
import ko from './locales/ko/translation.json'
import ru from './locales/ru/translation.json'
import de from './locales/de/translation.json'
import fr from './locales/fr/translation.json'
import es from './locales/es/translation.json'

import changelogZhHans from './changelogs/changelog_zh_Hans'
import changelogZhHant from './changelogs/changelog_zh_Hant'
import changelogEn from './changelogs/changelog_en'

i18n.use(initReactI18next).init({
    resources: {
        'zh-Hans': {
            translation: zhHans,
        },
        'zh-Hant': {
            translation: zhHant,
        },
        en: {
            translation: en,
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
        es: {
            translation: es,
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
