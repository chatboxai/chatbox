import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'en-US'),
  },
}))

import Locale, { resolveAppLanguage, supportedLanguages, translationKeys } from './locales'

describe('resolveAppLanguage', () => {
  it('keeps the languages the app ships with', () => {
    for (const language of supportedLanguages) {
      expect(resolveAppLanguage(language)).toBe(language)
    }
  })

  it('maps BCP 47 locales to a supported language', () => {
    expect(resolveAppLanguage('fr')).toBe('fr')
    expect(resolveAppLanguage('fr-FR')).toBe('fr')
    expect(resolveAppLanguage('fr_CA')).toBe('fr')
    expect(resolveAppLanguage('en-US')).toBe('en')
    expect(resolveAppLanguage('de-AT')).toBe('de')
    expect(resolveAppLanguage('pt-BR')).toBe('pt-PT')
    expect(resolveAppLanguage('it')).toBe('it-IT')
    expect(resolveAppLanguage('nb')).toBe('nb-NO')
    expect(resolveAppLanguage('sv-SE')).toBe('sv')
    expect(resolveAppLanguage('tr-TR')).toBe('tr')
  })

  it('splits Chinese locales between simplified and traditional', () => {
    expect(resolveAppLanguage('zh')).toBe('zh-Hans')
    expect(resolveAppLanguage('zh-CN')).toBe('zh-Hans')
    expect(resolveAppLanguage('zh-Hans')).toBe('zh-Hans')
    expect(resolveAppLanguage('zh-TW')).toBe('zh-Hant')
    expect(resolveAppLanguage('zh-HK')).toBe('zh-Hant')
    expect(resolveAppLanguage('zh-Hant')).toBe('zh-Hant')
  })

  it('falls back to English for unknown or empty values', () => {
    expect(resolveAppLanguage(undefined)).toBe('en')
    expect(resolveAppLanguage(null)).toBe('en')
    expect(resolveAppLanguage('')).toBe('en')
    expect(resolveAppLanguage('   ')).toBe('en')
    expect(resolveAppLanguage('klingon')).toBe('en')
  })
})

describe('Locale', () => {
  it('translates the native menu labels in the application language', () => {
    const locale = new Locale('fr')
    expect(locale.t('Copy')).toBe('Copier')
    expect(locale.t('Cut')).toBe('Couper')
    expect(locale.t('Paste')).toBe('Coller')
    expect(locale.t('PasteAsPlainText')).toBe('Coller en texte brut')
    expect(locale.t('SelectAll')).toBe('Tout sélectionner')
    expect(locale.t('ReplaceWith')).toBe('Remplacer par')
    expect(locale.t('AddToDictionary')).toBe('Ajouter au dictionnaire')
  })

  it('does not depend on the operating system language', () => {
    // app.getLocale() is mocked to en-US: an English OS must not win over the app setting.
    expect(new Locale('fr').t('Copy')).toBe('Copier')
    expect(new Locale('de-DE').t('Copy')).toBe('Kopieren')
    expect(new Locale('zh-Hant').t('Copy')).toBe('複製')
  })

  it('uses the system locale when no application language is stored yet', () => {
    const locale = new Locale(undefined)
    expect(locale.locale).toBe('en')
    expect(locale.t('Copy')).toBe('Copy')
  })

  it('provides every label in every supported language', () => {
    for (const language of supportedLanguages) {
      const locale = new Locale(language)
      for (const key of translationKeys) {
        const label = locale.t(key)
        expect(label, `${language} is missing "${key}"`).toBeTypeOf('string')
        expect(label.trim(), `${language} has an empty "${key}"`).not.toBe('')
      }
    }
  })
})
