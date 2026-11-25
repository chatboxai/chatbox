import { app } from 'electron'

/**
 * Languages the application itself can be displayed in, as stored in `settings.language`.
 * Kept in sync with the `language` enum of the settings schema.
 */
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

export type AppLanguage = (typeof supportedLanguages)[number]

/**
 * Map any locale-ish string (an app setting, `app.getLocale()`, a BCP 47 tag such as
 * `fr-FR` or `zh-CN`) to one of the languages we ship labels for.
 * Unknown values fall back to English.
 */
export function resolveAppLanguage(candidate?: string | null): AppLanguage {
  if (!candidate || typeof candidate !== 'string') {
    return 'en'
  }

  const tag = candidate.trim().replace(/_/g, '-')
  if (!tag) {
    return 'en'
  }

  const exact = supportedLanguages.find((language) => language === tag)
  if (exact) {
    return exact
  }

  const lowerTag = tag.toLowerCase()
  const caseInsensitive = supportedLanguages.find((language) => language.toLowerCase() === lowerTag)
  if (caseInsensitive) {
    return caseInsensitive
  }

  const [base, ...rest] = lowerTag.split('-')
  const subtags = rest.join('-')

  if (base === 'zh') {
    // Traditional Chinese regions and the explicit `hant` script subtag.
    if (subtags.includes('hant') || ['tw', 'hk', 'mo'].some((region) => subtags.split('-').includes(region))) {
      return 'zh-Hant'
    }
    return 'zh-Hans'
  }

  // `fr-FR` -> `fr`, `it` -> `it-IT`, `pt-BR` -> `pt-PT`, `nb` -> `nb-NO`, ...
  const byBase = supportedLanguages.find((language) => language.toLowerCase().split('-')[0] === base)
  return byBase ?? 'en'
}

function systemLocale(): string | undefined {
  try {
    return app.getLocale()
  } catch (e) {
    console.error('Failed to get locale:', e)
    return undefined
  }
}

/**
 * Labels for the native menus (context menu, tray menu) built by the main process.
 *
 * Native menus are rendered by the OS, so they cannot reuse the renderer translations:
 * every label has to be provided here, in every language the app supports.
 */
export default class Locale {
  locale: AppLanguage

  /**
   * @param language the application language (`settings.language`). When it is missing
   * (first run, before the renderer stored its language) the OS locale is used instead.
   */
  constructor(language?: string | null) {
    this.locale = resolveAppLanguage(language ?? systemLocale())
  }

  isCN(): boolean {
    return this.locale.startsWith('zh')
  }

  t(key: TranslationKey): string {
    return translations[key][this.locale]
  }
}

export type TranslationKey =
  | 'Show/Hide'
  | 'Exit'
  | 'New_Version'
  | 'Restart'
  | 'Later'
  | 'App_Update'
  | 'New_Version_Downloaded'
  | 'Copy'
  | 'Cut'
  | 'Paste'
  | 'PasteAsPlainText'
  | 'SelectAll'
  | 'ReplaceWith'
  | 'AddToDictionary'
  | 'ResetZoom'
  | 'ZoomIn'
  | 'ZoomOut'

const translations: Record<TranslationKey, Record<AppLanguage, string>> = {
  'Show/Hide': {
    en: 'Show/Hide',
    'zh-Hans': '显示/隐藏',
    'zh-Hant': '顯示/隱藏',
    ja: '表示/非表示',
    ko: '표시/숨기기',
    ru: 'Показать/Скрыть',
    de: 'Anzeigen/Ausblenden',
    fr: 'Afficher/Masquer',
    'pt-PT': 'Mostrar/Ocultar',
    es: 'Mostrar/Ocultar',
    ar: 'إظهار/إخفاء',
    'it-IT': 'Mostra/Nascondi',
    sv: 'Visa/Dölj',
    'nb-NO': 'Vis/Skjul',
    tr: 'Göster/Gizle',
  },
  Exit: {
    en: 'Exit',
    'zh-Hans': '退出',
    'zh-Hant': '結束',
    ja: '終了',
    ko: '종료',
    ru: 'Выход',
    de: 'Beenden',
    fr: 'Quitter',
    'pt-PT': 'Sair',
    es: 'Salir',
    ar: 'خروج',
    'it-IT': 'Esci',
    sv: 'Avsluta',
    'nb-NO': 'Avslutt',
    tr: 'Çıkış',
  },
  New_Version: {
    en: 'New Version',
    'zh-Hans': '新版本',
    'zh-Hant': '新版本',
    ja: '新しいバージョン',
    ko: '새 버전',
    ru: 'Новая версия',
    de: 'Neue Version',
    fr: 'Nouvelle version',
    'pt-PT': 'Nova versão',
    es: 'Nueva versión',
    ar: 'إصدار جديد',
    'it-IT': 'Nuova versione',
    sv: 'Ny version',
    'nb-NO': 'Ny versjon',
    tr: 'Yeni sürüm',
  },
  Restart: {
    en: 'Restart',
    'zh-Hans': '重启',
    'zh-Hant': '重新啟動',
    ja: '再起動',
    ko: '다시 시작',
    ru: 'Перезапустить',
    de: 'Neu starten',
    fr: 'Redémarrer',
    'pt-PT': 'Reiniciar',
    es: 'Reiniciar',
    ar: 'إعادة التشغيل',
    'it-IT': 'Riavvia',
    sv: 'Starta om',
    'nb-NO': 'Start på nytt',
    tr: 'Yeniden başlat',
  },
  Later: {
    en: 'Later',
    'zh-Hans': '稍后',
    'zh-Hant': '稍後',
    ja: '後で',
    ko: '나중에',
    ru: 'Позже',
    de: 'Später',
    fr: 'Plus tard',
    'pt-PT': 'Mais tarde',
    es: 'Más tarde',
    ar: 'لاحقًا',
    'it-IT': 'Più tardi',
    sv: 'Senare',
    'nb-NO': 'Senere',
    tr: 'Daha sonra',
  },
  App_Update: {
    en: 'App Update',
    'zh-Hans': '应用更新',
    'zh-Hant': '應用程式更新',
    ja: 'アプリの更新',
    ko: '앱 업데이트',
    ru: 'Обновление приложения',
    de: 'App-Update',
    fr: "Mise à jour de l'application",
    'pt-PT': 'Atualização da aplicação',
    es: 'Actualización de la aplicación',
    ar: 'تحديث التطبيق',
    'it-IT': "Aggiornamento dell'app",
    sv: 'Appuppdatering',
    'nb-NO': 'Appoppdatering',
    tr: 'Uygulama güncellemesi',
  },
  New_Version_Downloaded: {
    en: 'New version has been downloaded, restart the application to apply the update.',
    'zh-Hans': '新版本已经下载好，重启应用以应用更新。',
    'zh-Hant': '新版本已下載完成，重新啟動應用程式以套用更新。',
    ja: '新しいバージョンをダウンロードしました。更新を適用するにはアプリを再起動してください。',
    ko: '새 버전이 다운로드되었습니다. 업데이트를 적용하려면 앱을 다시 시작하세요.',
    ru: 'Новая версия загружена. Перезапустите приложение, чтобы применить обновление.',
    de: 'Die neue Version wurde heruntergeladen. Starten Sie die Anwendung neu, um das Update anzuwenden.',
    fr: "La nouvelle version a été téléchargée. Redémarrez l'application pour appliquer la mise à jour.",
    'pt-PT': 'A nova versão foi transferida. Reinicie a aplicação para aplicar a atualização.',
    es: 'La nueva versión se ha descargado. Reinicia la aplicación para aplicar la actualización.',
    ar: 'تم تنزيل الإصدار الجديد، أعد تشغيل التطبيق لتطبيق التحديث.',
    'it-IT': "La nuova versione è stata scaricata. Riavvia l'applicazione per applicare l'aggiornamento.",
    sv: 'Den nya versionen har laddats ner. Starta om programmet för att tillämpa uppdateringen.',
    'nb-NO': 'Den nye versjonen er lastet ned. Start appen på nytt for å bruke oppdateringen.',
    tr: 'Yeni sürüm indirildi. Güncellemeyi uygulamak için uygulamayı yeniden başlatın.',
  },
  Copy: {
    en: 'Copy',
    'zh-Hans': '复制',
    'zh-Hant': '複製',
    ja: 'コピー',
    ko: '복사',
    ru: 'Копировать',
    de: 'Kopieren',
    fr: 'Copier',
    'pt-PT': 'Copiar',
    es: 'Copiar',
    ar: 'نسخ',
    'it-IT': 'Copia',
    sv: 'Kopiera',
    'nb-NO': 'Kopier',
    tr: 'Kopyala',
  },
  Cut: {
    en: 'Cut',
    'zh-Hans': '剪切',
    'zh-Hant': '剪下',
    ja: '切り取り',
    ko: '잘라내기',
    ru: 'Вырезать',
    de: 'Ausschneiden',
    fr: 'Couper',
    'pt-PT': 'Cortar',
    es: 'Cortar',
    ar: 'قص',
    'it-IT': 'Taglia',
    sv: 'Klipp ut',
    'nb-NO': 'Klipp ut',
    tr: 'Kes',
  },
  Paste: {
    en: 'Paste',
    'zh-Hans': '粘贴',
    'zh-Hant': '貼上',
    ja: '貼り付け',
    ko: '붙여넣기',
    ru: 'Вставить',
    de: 'Einfügen',
    fr: 'Coller',
    'pt-PT': 'Colar',
    es: 'Pegar',
    ar: 'لصق',
    'it-IT': 'Incolla',
    sv: 'Klistra in',
    'nb-NO': 'Lim inn',
    tr: 'Yapıştır',
  },
  PasteAsPlainText: {
    en: 'Paste as Plain Text',
    'zh-Hans': '粘贴为文本',
    'zh-Hant': '貼為純文字',
    ja: 'プレーンテキストとして貼り付け',
    ko: '서식 없이 붙여넣기',
    ru: 'Вставить как текст',
    de: 'Als reinen Text einfügen',
    fr: 'Coller en texte brut',
    'pt-PT': 'Colar como texto simples',
    es: 'Pegar como texto sin formato',
    ar: 'لصق كنص عادي',
    'it-IT': 'Incolla come testo semplice',
    sv: 'Klistra in som oformaterad text',
    'nb-NO': 'Lim inn som ren tekst',
    tr: 'Düz metin olarak yapıştır',
  },
  SelectAll: {
    en: 'Select All',
    'zh-Hans': '全选',
    'zh-Hant': '全選',
    ja: 'すべて選択',
    ko: '모두 선택',
    ru: 'Выделить всё',
    de: 'Alles auswählen',
    fr: 'Tout sélectionner',
    'pt-PT': 'Selecionar tudo',
    es: 'Seleccionar todo',
    ar: 'تحديد الكل',
    'it-IT': 'Seleziona tutto',
    sv: 'Markera allt',
    'nb-NO': 'Merk alt',
    tr: 'Tümünü seç',
  },
  ReplaceWith: {
    en: 'Replace with',
    'zh-Hans': '替换成',
    'zh-Hant': '取代為',
    ja: '置換:',
    ko: '바꾸기',
    ru: 'Заменить на',
    de: 'Ersetzen durch',
    fr: 'Remplacer par',
    'pt-PT': 'Substituir por',
    es: 'Reemplazar por',
    ar: 'استبدال بـ',
    'it-IT': 'Sostituisci con',
    sv: 'Ersätt med',
    'nb-NO': 'Erstatt med',
    tr: 'Şununla değiştir',
  },
  AddToDictionary: {
    en: 'Add to Dictionary',
    'zh-Hans': '添加到词典',
    'zh-Hant': '新增至字典',
    ja: '辞書に追加',
    ko: '사전에 추가',
    ru: 'Добавить в словарь',
    de: 'Zum Wörterbuch hinzufügen',
    fr: 'Ajouter au dictionnaire',
    'pt-PT': 'Adicionar ao dicionário',
    es: 'Añadir al diccionario',
    ar: 'إضافة إلى القاموس',
    'it-IT': 'Aggiungi al dizionario',
    sv: 'Lägg till i ordlistan',
    'nb-NO': 'Legg til i ordlisten',
    tr: 'Sözlüğe ekle',
  },
  ResetZoom: {
    en: 'Reset Zoom',
    'zh-Hans': '重置缩放',
    'zh-Hant': '重設縮放',
    ja: 'ズームをリセット',
    ko: '확대/축소 초기화',
    ru: 'Сбросить масштаб',
    de: 'Zoom zurücksetzen',
    fr: 'Réinitialiser le zoom',
    'pt-PT': 'Repor o zoom',
    es: 'Restablecer el zoom',
    ar: 'إعادة تعيين التكبير',
    'it-IT': 'Reimposta zoom',
    sv: 'Återställ zoom',
    'nb-NO': 'Tilbakestill zoom',
    tr: 'Yakınlaştırmayı sıfırla',
  },
  ZoomIn: {
    en: 'Zoom In',
    'zh-Hans': '放大',
    'zh-Hant': '放大',
    ja: '拡大',
    ko: '확대',
    ru: 'Увеличить',
    de: 'Vergrößern',
    fr: 'Zoom avant',
    'pt-PT': 'Aumentar o zoom',
    es: 'Acercar el zoom',
    ar: 'تكبير',
    'it-IT': 'Zoom avanti',
    sv: 'Zooma in',
    'nb-NO': 'Zooma inn',
    tr: 'Yakınlaştır',
  },
  ZoomOut: {
    en: 'Zoom Out',
    'zh-Hans': '缩小',
    'zh-Hant': '縮小',
    ja: '縮小',
    ko: '축소',
    ru: 'Уменьшить',
    de: 'Verkleinern',
    fr: 'Zoom arrière',
    'pt-PT': 'Diminuir o zoom',
    es: 'Alejar el zoom',
    ar: 'تصغير',
    'it-IT': 'Zoom indietro',
    sv: 'Zooma ut',
    'nb-NO': 'Zooma ut',
    tr: 'Uzaklaştır',
  },
}

export const translationKeys = Object.keys(translations) as TranslationKey[]
