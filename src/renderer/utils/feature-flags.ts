import platform from '@/platform'

export const featureFlags = {
  mcp: platform.isDesktopLike,
  knowledgeBase: platform.isDesktopLike,
  skills: platform.isDesktopLike,
  agentMode: platform.isDesktopLike,
}
