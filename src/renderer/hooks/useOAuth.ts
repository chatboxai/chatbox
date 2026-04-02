import type { OAuthProviderInfo } from '@shared/oauth'

type OAuthFlowType = 'callback' | 'code-paste' | 'device-code'

interface OAuthActionResult {
  success: boolean
  error?: string
  authUrl?: string
  instructions?: string
  userCode?: string
  verificationUri?: string
}

interface UseOAuthResult {
  isDesktop: boolean
  hasOAuth: boolean
  isOAuthActive: boolean
  isOAuthExpired: boolean
  flowType: OAuthFlowType
  loginCallback: () => Promise<OAuthActionResult>
  startLogin: () => Promise<OAuthActionResult>
  exchangeCode: (code: string) => Promise<OAuthActionResult>
  startDeviceFlow: () => Promise<OAuthActionResult>
  waitForDeviceToken: () => Promise<OAuthActionResult>
  cancel: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
  error: null
}

const OAUTH_UNAVAILABLE_RESULT: OAuthActionResult = {
  success: false,
  error: 'OAuth is not available in the open-source edition.',
}

// No-op OAuth hook for open-source edition
export function useOAuth(
  _providerId: string | undefined,
  _providerInfo?: OAuthProviderInfo,
  _settingsProviderId?: string,
  _chatboxProviderId?: string
): UseOAuthResult {
  return {
    isDesktop: false,
    hasOAuth: false,
    isOAuthActive: false,
    isOAuthExpired: false,
    flowType: 'callback',
    loginCallback: async (): Promise<OAuthActionResult> => OAUTH_UNAVAILABLE_RESULT,
    startLogin: async (): Promise<OAuthActionResult> => OAUTH_UNAVAILABLE_RESULT,
    exchangeCode: async (_code: string): Promise<OAuthActionResult> => OAUTH_UNAVAILABLE_RESULT,
    startDeviceFlow: async (): Promise<OAuthActionResult> => OAUTH_UNAVAILABLE_RESULT,
    waitForDeviceToken: async (): Promise<OAuthActionResult> => OAUTH_UNAVAILABLE_RESULT,
    cancel: async (): Promise<void> => {},
    login: async (): Promise<void> => {},
    logout: async () => {},
    refresh: async () => {},
    isLoading: false,
    error: null,
  }
}
