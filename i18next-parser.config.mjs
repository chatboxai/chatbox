export default {
  input: ['src/renderer/**/*.{js,jsx,ts,tsx}', 'packages/chatbox-core/src/session/message-finish-tip.ts'],
  output: 'packages/chatbox-i18n/src/locales/$LOCALE/$NAMESPACE.json',
  locales: ['en', 'ar', 'de', 'es', 'fr', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant'],
  createOldCatalogs: false,
  keepRemoved: false,
  pluralSeparator: false,
  keySeparator: false,
  namespaceSeparator: false,
  sort: true,
}
