export type ViewMode = 'login' | 'licenseKey'

export type LoginState = 'idle' | 'requesting' | 'polling' | 'success' | 'error' | 'timeout'

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
