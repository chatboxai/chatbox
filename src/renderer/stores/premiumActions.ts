import {
  prepareLicenseActivation,
  licenseActivationSettings,
  licenseDeactivationSettings,
} from '@shared/services/license-activation'
import omit from 'lodash/omit'
import { FetchError } from 'ofetch'
import { useEffect } from 'react'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { getLogger } from '@/lib/utils'
import { mcpController } from '@/packages/mcp/controller'
import { reportError } from '@/utils/sentry'
import * as remote from '../packages/remote'
import platform from '../platform'
import { authInfoStore } from './authInfoStore'
import { settingsStore, useSettingsStore } from './settingsStore'

const log = getLogger('premium-actions')

export function reconcileLoginLicenseState() {
  const settings = settingsStore.getState()
  if (settings.licenseActivationMethod !== 'login' || !settings.licenseKey) {
    return false
  }
  if (authInfoStore.getState().getTokens()) {
    return false
  }

  const licenseKey = settings.licenseKey
  settingsStore.setState((state) => ({
    licenseKey: '',
    licenseDetail: undefined,
    licensePlanName: undefined,
    licenseActivationMethod: undefined,
    licenseInstances: omit(state.licenseInstances, licenseKey),
    hasExpiredLicense: false,
    mcp: {
      ...state.mcp,
      enabledBuiltinServers: [],
    },
  }))
  settings.mcp.enabledBuiltinServers.forEach((serverId) => {
    mcpController.stopServer(serverId).catch(console.error)
  })
  remote.invalidateSessionRagConfigCache()
  log.info('Cleared stale login license state because auth tokens are missing')
  return true
}

export function initLoginLicenseStateReconciliation() {
  reconcileLoginLicenseState()
  return authInfoStore.subscribe(
    (state) => (state.accessToken && state.refreshToken ? 'signed-in' : 'signed-out'),
    (authState) => {
      if (authState === 'signed-out') {
        reconcileLoginLicenseState()
      }
    }
  )
}

/**
 * 自动验证当前的 license 是否有效，如果无效则清除相关数据
 * @returns {boolean} whether the user has validated before
 */
export function useAutoValidate(): boolean {
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const licenseInstances = useSettingsStore((state) => state.licenseInstances)
  const clearValidatedData = (key: string, instance: string) => {
    const current = settingsStore.getState()
    if (current.licenseKey !== key || current.licenseInstances?.[key] !== instance) return
    settingsStore.setState((state) => ({
      licenseKey: '',
      licenseInstances: omit(state.licenseInstances, state.licenseKey || ''),
      licenseDetail: undefined,
      licensePlanName: undefined,
      licenseActivationMethod: undefined,
      hasExpiredLicense: true,
    }))
  }
  useEffect(() => {
    void (async () => {
      if (!licenseKey || !licenseInstances) {
        // 这里不清除数据，因为可能是本地数据尚未加载
        return
      }
      const instanceId = licenseInstances[licenseKey] || ''
      try {
        // 在 lemonsqueezy 检查 license 是否有效，主要检查是否过期、被禁用的情况。若无效则清除相关数据
        const result = await remote.validateLicense({
          licenseKey: licenseKey,
          instanceId: instanceId,
        })
        if (result.valid === false) {
          clearValidatedData(licenseKey, instanceId)
          log.info(`clear license validated data due to invalid result: ${JSON.stringify(result)}`)
          return
        }
      } catch (err) {
        // 如果错误码为 401 或 403，则清除数据
        if (err instanceof FetchError && err.status && [401, 403, 404].includes(err.status)) {
          clearValidatedData(licenseKey, instanceId)
          log.info(`clear license validated data due to respones status: ${err.status}`)
        } else if (!(err instanceof FetchError)) {
          // Expected API/network failures keep the current validation state and stay out of Sentry.
          reportError(err, {
            domain: 'subscription',
            operation: 'validate_license',
          })
        }
      }
    })()
  }, [licenseKey, licenseInstances?.[licenseKey || '']])
  // licenseKey 且对应的 instanceId 都存在时，表示验证通过
  if (!licenseKey || !licenseInstances) {
    return false
  }
  return !!licenseInstances[licenseKey]
}

/**
 * 取消激活当前的 license
 * @param clearLoginState 是否清除登录状态（默认true）。在login方式下切换license时传false
 */
export async function deactivate(clearLoginState = true) {
  const settings = settingsStore.getState()

  // 如果是login方式激活的，同时清除登录状态（除非是在切换license）
  if (clearLoginState && settings.licenseActivationMethod === 'login') {
    const { authInfoStore } = await import('./authInfoStore')
    authInfoStore.getState().clearTokens()
  }

  // 更新本地状态
  settingsStore.setState((settings) => ({
    ...licenseDeactivationSettings(settings),
    mcp: {
      ...settings.mcp,
      enabledBuiltinServers: [],
    },
  }))
  // 停止所有内置MCP服务器
  settings.mcp.enabledBuiltinServers.forEach((serverId) => {
    mcpController.stopServer(serverId).catch(console.error)
  })
  // 更新服务器状态（取消激活 license）
  const licenseKey = settings.licenseKey || ''
  const licenseInstances = settings.licenseInstances || {}
  if (licenseKey && licenseInstances[licenseKey]) {
    await remote.deactivateLicense({
      licenseKey,
      instanceId: licenseInstances[licenseKey],
    })
  }
}

/**
 * 激活新的 license key
 * @param licenseKey
 * @param method 激活方式：'login' 表示通过登录激活，'manual' 表示手动输入license key激活
 * @returns
 */
export async function activate(
  licenseKey: string,
  method: 'login' | 'manual' = 'manual',
  options?: { pageName?: string; accountEmail?: string }
) {
  const pageName = options?.pageName ?? JK_PAGE_NAMES.SETTING_PAGE
  const shouldTrackKeyVerifyEvent = method !== 'login'
  const result = await prepareLicenseActivation(licenseKey, {
    activate: async (key) =>
      remote.activateLicense({ licenseKey: key, instanceName: await platform.getInstanceName() }),
    getDetail: async (key) => {
      const response = await remote.getLicenseDetailRealtime({ licenseKey: key })
      return { detail: response.data ?? null, error: response.error }
    },
  })
  if (!result.valid) {
    if (shouldTrackKeyVerifyEvent) {
      trackJkClickEvent(JK_EVENTS.KEY_VERIFY_FAILED, {
        pageName,
        content: result.error,
        contentType: 'Chatbox AI',
        props: { content_add_info: { content: 'Chatbox AI' } },
      })
    }
    return result
  }
  const previous = settingsStore.getState()
  const switching = !!previous.licenseKey && previous.licenseKey !== result.licenseKey
  settingsStore.setState((current) => ({
    ...licenseActivationSettings(current, result, method, options?.accountEmail),
    ...(switching ? { mcp: { ...current.mcp, enabledBuiltinServers: [] } } : {}),
  }))
  if (switching) {
    previous.mcp.enabledBuiltinServers.forEach((serverId) => {
      mcpController.stopServer(serverId).catch(console.error)
    })
    const oldKey = previous.licenseKey!
    const oldInstance = previous.licenseInstances?.[oldKey]
    if (oldInstance) {
      void remote.deactivateLicense({ licenseKey: oldKey, instanceId: oldInstance }).catch(() => {
        log.warn('Failed to deactivate the previous license remotely')
      })
    }
  }
  if (method === 'manual') authInfoStore.getState().clearTokens()
  remote.invalidateSessionRagConfigCache()
  if (shouldTrackKeyVerifyEvent) {
    trackJkClickEvent(JK_EVENTS.KEY_VERIFY_SUCCESS, {
      pageName,
      content: licenseKey,
      contentType: 'Chatbox AI',
      props: { content_add_info: { content: 'Chatbox AI' } },
    })
  }
  log.info(`✅ Activated license key: ${licenseKey.slice(0, 8)}**** and cleared default RAG fallback models`)
  return result
}
