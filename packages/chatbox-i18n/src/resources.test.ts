import { describe, expect, it } from 'vitest'
import { supportedLanguages, translationResources } from './index'
import { mobileSupportedLanguages, mobileTranslationOverlays, mobileTranslationResources } from './mobile'

const PLACEHOLDER_PATTERN = /{{[^{}]+}}/g

function placeholders(value: string) {
  return [...(value.match(PLACEHOLDER_PATTERN) ?? [])].sort()
}

describe('shared translation resources', () => {
  it('keeps every locale aligned with the English source keys', () => {
    const englishKeys = Object.keys(translationResources.en.translation).sort()

    for (const language of supportedLanguages) {
      const translation = translationResources[language].translation
      expect(Object.keys(translation).sort(), language).toEqual(englishKeys)
      expect(
        Object.values(translation).every((value) => value.trim().length > 0),
        language
      ).toBe(true)
    }
  })

  it('keeps every mobile locale aligned with the mobile English source keys and placeholders', () => {
    const english = mobileTranslationResources.en.translation
    const englishKeys = Object.keys(english).sort()

    for (const language of mobileSupportedLanguages) {
      const translation = mobileTranslationResources[language].translation
      expect(Object.keys(translation).sort(), language).toEqual(englishKeys)
      expect(
        Object.values(translation).every((value) => value.trim().length > 0),
        language
      ).toBe(true)

      const englishOverlay = mobileTranslationOverlays.en
      const translationOverlay = mobileTranslationOverlays[language]
      for (const key of Object.keys(englishOverlay) as (keyof typeof englishOverlay)[]) {
        expect(placeholders(translationOverlay[key]), `${language}: ${key}`).toEqual(placeholders(englishOverlay[key]))
      }
    }
  })
})
