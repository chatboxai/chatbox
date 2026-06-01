import platform from '@/platform'

export const featureFlags = {
  mcp: platform.type === 'desktop' || platform.type === 'mobile' || platform.type === 'web',
  knowledgeBase: platform.type === 'desktop',
  skills: false,
  taskMode: false,
}
