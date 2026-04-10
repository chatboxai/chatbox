export type ViewMode = 'login' | 'licenseKey'

export type LoginState = 'idle' | 'sending_code' | 'code_sent' | 'verifying_code' | 'success' | 'error'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface UserProfile {
  email: string
  id: string
  created_at: string
}

export type { UserLicense } from '@/packages/remote'
