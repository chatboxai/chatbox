export default {
  input: ['src/renderer/**/*.{js,jsx,ts,tsx}'],
  output: 'src/renderer/i18n/locales/$LOCALE/$NAMESPACE.json',
  locales: ['en', 'ar', 'de', 'es', 'fr', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant'],
  createOldCatalogs: false,
  keepRemoved: true,
  pluralSeparator: false,
  keySeparator: false,
  namespaceSeparator: false,
  sort: true,
}
