import { ModelProviderEnum } from '@shared/types'

export function resolveWebBrowsingMode(
  sessionId: string,
  provider: string | undefined,
  sessionWebBrowsingMap: Record<string, boolean | undefined>,
  newSessionWebBrowsingDefault: boolean | undefined
): boolean {
  const sessionValue = sessionWebBrowsingMap[sessionId]
  if (sessionValue !== undefined) {
    return sessionValue
  }
  if (sessionId === 'new' && newSessionWebBrowsingDefault !== undefined) {
    return newSessionWebBrowsingDefault
  }
  return provider === ModelProviderEnum.ChatboxAI
}
