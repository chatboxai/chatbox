import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '@/stores/settingsStore'

export function useI18nEffect() {
  const language = useLanguage()
  const { i18n } = useTranslation()
  useEffect(() => {
    void (async () => {
      i18n.changeLanguage(language)
    })()
  }, [language])
}
