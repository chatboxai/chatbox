import type { Language } from '../../shared/types'

// 将桌面端 getLocale、浏览器的 navigator.language 返回的语言信息，转换为应用的 locale
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
  if (locale.startsWith('pt')) {
    // 这两种语言都是葡萄牙语，但是区域不同，一些用词习惯也不同，以后可能需要区分
    // 葡萄牙（Portugal） - pt-PT
    // 巴西（Brazil） - pt-BR
    return 'pt-PT'
  }
  if (locale.startsWith('es')) {
    return 'es'
  }
  if (locale.startsWith('ar')) {
    return 'ar'
  }
  if (locale.startsWith('it')) {
    return 'it-IT'
  }
  if (locale.startsWith('sv')) {
    return 'sv'
  }
  if (locale.startsWith('nb')) {
    return 'nb-NO'
  }
  return 'en'
}
