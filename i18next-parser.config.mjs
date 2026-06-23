export default {
  input: ['src/renderer/**/*.{js,jsx,ts,tsx}'],
  output: 'src/renderer/i18n/locales/$LOCALE/$NAMESPACE.json',
  locales: ['en', 'ar', 'de', 'es', 'fa', 'fr', 'it-IT', 'ja', 'ko', 'nb-NO', 'pt-PT', 'ru', 'sv', 'zh-Hans', 'zh-Hant'],
  createOldCatalogs: false,
  keepRemoved: false,
  pluralSeparator: false,
  keySeparator: false,
  namespaceSeparator: false,
  sort: true,
}
