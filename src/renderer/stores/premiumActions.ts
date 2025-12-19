import * as Sentry from '@sentry/react'
import omit from 'lodash/omit'
import { FetchError } from 'ofetch'
import { useEffect } from 'react'
import { mcpController } from '@/packages/mcp/controller'
import * as remote from '../packages/remote'
import platform from '../platform'
import { settingsStore, useSettingsStore } from './settingsStore'

/**
 * 自动验证当前的 license 是否有效，如果无效则清除相关数据
 * @returns {boolean} whether the user has validated before
 */
export function useAutoValidate() {
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const licenseInstances = useSettingsStore((state) => state.licenseInstances)
  const clearValidatedData = () => {
    settingsStore.setState((state) => ({
      licenseKey: '',
      licenseInstances: omit(state.licenseInstances, state.licenseKey || ''),
      licenseDetail: undefined,
      licenseActivationMethod: undefined,
    }))
  }
  useEffect(() => {
    ;(async () => {
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
          clearValidatedData()
          platform.appLog('info', `clear license validated data due to invalid result: ${JSON.stringify(result)}`)
          return
        }
      } catch (err) {
        // 如果错误码为 401 或 403，则清除数据
        if (err instanceof FetchError && err.status && [401, 403, 404].includes(err.status)) {
          clearValidatedData()
          platform.appLog('info', `clear license validated data due to respones status: ${err.status}`)
        } else {
          // 其余情况可能是联网出现问题，不清除数据
          Sentry.captureException(err)
        }
      }
    })()
  }, [licenseKey])
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
    console.log('🔓 Cleared login tokens due to license deactivation')
  }

  // 更新本地状态
  settingsStore.setState((settings) => ({
    licenseKey: '',
    licenseDetail: undefined,
    licenseActivationMethod: undefined,
    licenseInstances: omit(settings.licenseInstances, settings.licenseKey || ''),
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
export async function activate(licenseKey: string, method: 'login' | 'manual' = 'manual') {
  const settings = settingsStore.getState()

  // 互斥逻辑：manual方式激活时，清除login状态
  if (method === 'manual') {
    const { authInfoStore } = await import('./authInfoStore')
    authInfoStore.getState().clearTokens()
    console.log('🔓 Cleared login tokens due to manual license activation')
  }

  // 取消激活已存在的 license
  if (settings.licenseKey) {
    // 如果是登录状态下，从一个 license 切换到另一个 license，不清除登录状态
    const isSwitchingLicense = method === 'login' && settings.licenseActivationMethod === 'login'
    await deactivate(!isSwitchingLicense)
  }
  // 激活新的 license key，获取 instanceId
  const result = await remote.activateLicense({
    licenseKey,
    instanceName: await platform.getInstanceName(),
  })
  if (!result.valid) {
    return result
  }
  // 获取 license 详情
  const licenseDetail = await remote.getLicenseDetailRealtime({ licenseKey })
  // 设置本地的 license 数据
  settingsStore.setState((settings) => ({
    licenseKey,
    licenseActivationMethod: method,
    licenseInstances: {
      ...(settings.licenseInstances || {}),
      [licenseKey]: result.instanceId,
    },
    licenseDetail: licenseDetail || undefined,
  }))
  return result
}
