import { CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR } from '@shared/file-parse-errors'
import { ChatboxAIAPIError } from '@shared/models/errors'

export const CHATBOX_AI_PARSER_SIGN_IN_ONLY_I18N_KEY =
  '<OpenSettingButton>Sign in to Chatbox AI</OpenSettingButton> to use your account license.'

export function getFileParseErrorI18nKey(errorCode: string, isDesktopLike: boolean): string | undefined {
  if (errorCode === CHATBOX_AI_PARSER_LICENSE_KEY_REQUIRED_ERROR && !isDesktopLike) {
    return CHATBOX_AI_PARSER_SIGN_IN_ONLY_I18N_KEY
  }
  return ChatboxAIAPIError.codeNameMap[errorCode]?.i18nKey
}
