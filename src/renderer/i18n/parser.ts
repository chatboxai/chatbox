import { Language } from '../../shared/types'

export function parseLocale(locale: string): Language {
    if (
        locale === 'zh' ||
        locale.startsWith('zh_CN') ||
        locale.startsWith('zh-CN') ||
        locale.startsWith('zh_Hans') ||
        locale.startsWith('zh-Hans')
    ) {
        return 'zh-Hans'
    }
    if (
        locale.startsWith('zh_HK') ||
        locale.startsWith('zh-HK') ||
        locale.startsWith('zh_TW') ||
        locale.startsWith('zh-TW') ||
        locale.startsWith('zh_Hant') ||
        locale.startsWith('zh-Hant')
    ) {
        return 'zh-Hant'
    }
    if (locale.startsWith('ja')) {
        return 'ja'
    }
    if (locale.startsWith('ko')) {
        return 'ko'
    }
    if (locale.startsWith('ru')) {
        return 'ru'
    }
    if (locale.startsWith('de')) {
        return 'de'
    }
    if (locale.startsWith('fr')) {
        return 'fr'
    }
    if (locale.startsWith('es')) {
        return 'es'
    }
    return 'en'
}
