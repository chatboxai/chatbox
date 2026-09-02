export type ViewMode = 'login' | 'licenseKey'

export type LoginState = 'idle' | 'sending_code' | 'code_sent' | 'verifying_code' | 'success' | 'error'

export type { AuthTokens } from '@/stores/authInfoStore'

export interface UserProfile {
  email: string
  id: string
  created_at: string
}

export type { UserLicense } from '@/packages/remote'
