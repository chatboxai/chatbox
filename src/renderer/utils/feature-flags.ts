import platform from '@/platform'

export const featureFlags = {
  mcp: platform.isDesktopLike || platform.type === 'mobile',
  knowledgeBase: platform.isDesktopLike,
  skills: platform.isDesktopLike,
  agentMode: platform.isDesktopLike || platform.type === 'mobile',
}
