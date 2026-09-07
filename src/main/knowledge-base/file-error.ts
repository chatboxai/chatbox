import { ChatboxAIAPIError } from '../../shared/models/errors'

/**
 * Normalize a knowledge-base processing failure before storing it.
 * Stable error codes stay intact so the renderer can attach localized actions.
 */
export function normalizeKnowledgeBaseFileError(errorMessage: string): string {
  if (ChatboxAIAPIError.codeNameMap[errorMessage]) {
    return errorMessage
  }

  try {
    const jsonMatch = errorMessage.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const errorCode = parsed.error?.code

      if (errorCode && ChatboxAIAPIError.codeNameMap[errorCode]) {
        return ChatboxAIAPIError.codeNameMap[errorCode].i18nKey
      }
      if (parsed.error?.detail) {
        return parsed.error.detail
      }
      if (parsed.error?.title) {
        return parsed.error.title
      }
    }
  } catch {
    // Keep the original message when the response is not valid JSON.
  }
  return errorMessage
}
