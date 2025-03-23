// import { app } from 'electron'
//
// export default class Locale {
//     locale: string = 'en'
//
//     constructor() {
//         try {
//             this.locale = app.getLocale()
//         } catch (e) {
//             console.log(e)
//         }
//     }
//
//     isCN(): boolean {
//         return this.locale.startsWith('zh')
//     }
//
//     t(key: TranslationKey): string {
//         return translations[key][this.isCN() ? 'zh' : 'en']
//     }
// }
//
// type TranslationKey = keyof typeof translations
//
// const translations = {
//     New_Version: {
//         en: 'New Version',
//         zh: '新版本',
//     },
//     Restart: {
//         en: 'Restart',
//         zh: '重启',
//     },
//     Later: {
//         en: 'Later',
//         zh: '稍后',
//     },
//     App_Update: {
//         en: 'App Update',
//         zh: '应用更新',
//     },
//     New_Version_Downloaded: {
//         en: 'New version has been downloaded, restart the application to apply the update.',
//         zh: '新版本已经下载好，重启应用以应用更新。',
//     },
//     Copy: {
//         en: 'Copy',
//         zh: '复制',
//     },
//     Cut: {
//         en: 'Cut',
//         zh: '剪切',
//     },
//     Paste: {
//         en: 'Paste',
//         zh: '粘贴',
//     },
//     ReplaceWith: {
//         en: 'Replace with',
//         zh: '替换成',
//     },
// }
