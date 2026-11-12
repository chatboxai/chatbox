import type { ChatboxAILicenseDetail } from '@shared/types/settings'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { getComputePointsRemainingPercentage } from './compute-points'
import type { ChatboxCliCommandDefinition } from './types'

function maskLicenseKey(key?: string): string | undefined {
  if (!key) return undefined
  return `configured (...${key.slice(-4)})`
}

function quotaSummary(detail?: ChatboxAILicenseDetail) {
  if (!detail) return undefined
  return {
    unifiedTokens: {
      remainingPercentage: getComputePointsRemainingPercentage(detail),
      used: detail.unified_token_usage,
      total: detail.unified_token_limit,
      nextRefreshTime: detail.token_next_refresh_time,
      expireTime: detail.token_expire_time,
      details: detail.unified_token_usage_details,
    },
    expansionPack: {
      remaining: Math.max((detail.expansion_pack_limit || 0) - (detail.expansion_pack_usage || 0), 0),
      used: detail.expansion_pack_usage,
      total: detail.expansion_pack_limit,
    },
    image: {
      remaining: Math.max((detail.image_total_quota || 0) - (detail.image_used_count || 0), 0),
      used: detail.image_used_count,
      total: detail.image_total_quota,
      planLimit: detail.plan_image_limit,
    },
  }
}

function accountStatus(): Record<string, unknown> {
  const settings = settingsStore.getState()
  const detail = settings.licenseDetail
  return {
    signedIn: settings.licenseActivationMethod === 'login',
    licenseConfigured: Boolean(settings.licenseKey),
    licenseKey: maskLicenseKey(settings.licenseKey),
    activationMethod: settings.licenseActivationMethod ?? 'none',
    hasExpiredLicense: Boolean(settings.hasExpiredLicense),
    plan: detail
      ? {
          name: detail.name,
          plan: detail.plan,
          status: detail.status,
          type: detail.type,
          defaultModel: detail.defaultModel,
          priceType: detail.price_type,
          orderType: detail.order_type,
          expiresAt: detail.expires_at,
        }
      : settings.licensePlanName
        ? { name: settings.licensePlanName }
        : undefined,
    quota: quotaSummary(detail),
  }
}

export const accountCommands: ChatboxCliCommandDefinition[] = [
  {
    path: ['version'],
    description: 'Show installed Chatbox client version and platform.',
    usage: 'chatbox version',
    async execute() {
      const [installedVersion, platformName] = await Promise.all([
        platform.getVersion().catch(() => 'unknown'),
        platform.getPlatform().catch(() => 'unknown'),
      ])
      return { installedVersion, platform: platformName }
    },
  },
  {
    path: ['account', 'status'],
    description: 'Show masked account, plan, and cached quota status.',
    usage: 'chatbox account status',
    execute: accountStatus,
  },
  {
    path: ['account', 'license'],
    description: 'Show masked license and plan details.',
    usage: 'chatbox account license',
    execute() {
      const status = accountStatus()
      return {
        licenseConfigured: status.licenseConfigured,
        licenseKey: status.licenseKey,
        activationMethod: status.activationMethod,
        hasExpiredLicense: status.hasExpiredLicense,
        plan: status.plan,
      }
    },
  },
  {
    path: ['account', 'quota'],
    description: 'Show cached token, image, and expansion-pack quota.',
    usage: 'chatbox account quota',
    execute() {
      const status = accountStatus()
      return { quota: status.quota, licenseConfigured: status.licenseConfigured }
    },
  },
  {
    path: ['account', 'refresh'],
    description: 'Refresh license and quota details from Chatbox API.',
    usage: 'chatbox account refresh',
    execute: refreshChatboxAccount,
  },
]

export async function refreshChatboxAccount() {
  const licenseKey = settingsStore.getState().licenseKey
  if (!licenseKey) return { refreshed: false, error: 'No Chatbox license is configured.', status: accountStatus() }

  const response = await remote.getLicenseDetailRealtime({ licenseKey })
  const isExpired = response.error?.code === 'expired' || response.error?.code === 'expired_license'
  if (response.data) {
    settingsStore.setState({
      licenseDetail: response.data,
      licensePlanName: response.data.name,
      hasExpiredLicense: isExpired,
    })
  } else if (isExpired) {
    settingsStore.setState({ hasExpiredLicense: true })
  }
  return { refreshed: Boolean(response.data), error: response.error, status: accountStatus() }
}
