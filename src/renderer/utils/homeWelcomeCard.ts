export type WelcomeCardMode = 'guide' | 'copilots' | 'no-license' | 'none'

export function getHomeWelcomeCardMode(_params: {
  providerCount: number
  isLoggedIn: boolean
  hasLicense: boolean
}): WelcomeCardMode {
  // 已登录或有许可证时，不显示引导卡片
  if (_params.isLoggedIn || _params.hasLicense) return 'none'
  if (_params.providerCount === 0) return 'guide'
  return 'none'
}
