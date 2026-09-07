import { CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR } from '@shared/file-parse-errors'
import { describe, expect, test } from 'vitest'
import { CHATBOX_AI_PARSER_SIGN_IN_ONLY_I18N_KEY, getFileParseErrorI18nKey } from './file-parse-error'

describe('getFileParseErrorI18nKey', () => {
  test('offers parser alternatives only on desktop-like platforms', () => {
    expect(getFileParseErrorI18nKey(CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR, false)).toBe(
      CHATBOX_AI_PARSER_SIGN_IN_ONLY_I18N_KEY
    )
    expect(getFileParseErrorI18nKey(CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR, true)).toContain(
      '<OpenDocumentParserSettingButton>document parser</OpenDocumentParserSettingButton>'
    )
  })

  test('uses the registered error key for other file parsing failures', () => {
    expect(getFileParseErrorI18nKey('chatbox_ai_parser_failed', false)).toBe(
      'Chatbox AI document parsing failed. Please try again later.'
    )
  })
})
