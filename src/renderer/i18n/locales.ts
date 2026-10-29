import { languageNameMap as sharedLanguageNameMap, languages as sharedLanguages } from '@chatbox/i18n'
import type { Language } from '../../shared/types'

export const languageNameMap: Record<Language, string> = sharedLanguageNameMap

export const languages = [...sharedLanguages] as Language[]
