import platform from '@/platform'

export const featureFlags = {
  mcp: platform.type === 'desktop',
}
