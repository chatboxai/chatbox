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

export type ChatboxAIParserAccountError = 'points-exhausted' | 'free-points-exhausted' | 'plan-expired'

const CHATBOX_AI_PARSER_ACCOUNT_ERRORS = new Map<string, ChatboxAIParserAccountError>([
  ['token_quota_exhausted', 'points-exhausted'],
  ['free_token_quota_exhausted', 'free-points-exhausted'],
  ['token_quota_exhausted_free', 'free-points-exhausted'],
  ['expired_license', 'plan-expired'],
  ['license_downgraded', 'plan-expired'],
])

/**
 * Account state behind a Chatbox AI cloud parsing failure. These error codes are kept
 * intact through parsing so the UI can offer plan actions instead of a generic failure.
 */
export function getChatboxAIParserAccountError(errorCode: string | undefined): ChatboxAIParserAccountError | undefined {
  return errorCode ? CHATBOX_AI_PARSER_ACCOUNT_ERRORS.get(errorCode) : undefined
}

export function getChatboxAIParserAccountErrorLabel(
  errorCode: string | undefined,
  t: (key: string) => string
): string | undefined {
  const accountError = getChatboxAIParserAccountError(errorCode)
  if (!accountError) return undefined
  return accountError === 'plan-expired' ? t('License expired') : t('Not enough points')
}
