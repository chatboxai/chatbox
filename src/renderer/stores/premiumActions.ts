import { useEffect } from 'react'
import * as remote from '../packages/remote'
import { getDefaultStore, useAtom } from 'jotai'
import { settingsAtom } from '../stores/atoms'
import platform from '../platform'
import { FetchError } from 'ofetch'
import omit from 'lodash/omit'
import * as Sentry from '@sentry/react'
import { Settings } from 'src/shared/types'
import { mcpController } from '@/packages/mcp/controller'

/**
 * 自动验证当前的 license 是否有效，如果无效则清除相关数据
 * @returns {boolean} whether the user has validated before
 */
export function useAutoValidate() {
  const [settings, setSettings] = useAtom(settingsAtom)
  const clearValidatedData = () => {
    setSettings((settings) => ({
      ...settings,
      licenseKey: '',
      licenseInstances: omit(settings.licenseInstances, settings.licenseKey || ''),
      licenseDetail: undefined,
    }))
  }
  useEffect(() => {
    ;(async () => {
      if (!settings.licenseKey || !settings.licenseInstances) {
        // 这里不清除数据，因为可能是本地数据尚未加载
        return
      }
      const instanceId = settings.licenseInstances[settings.licenseKey] || ''
      try {
        // 在 lemonsqueezy 检查 license 是否有效，主要检查是否过期、被禁用的情况。若无效则清除相关数据
        const result = await remote.validateLicense({
          licenseKey: settings.licenseKey,
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
  }, [settings.licenseKey])
  // licenseKey 且对应的 instanceId 都存在时，表示验证通过
  if (!settings.licenseKey || !settings.licenseInstances) {
    return false
  }
  return !!settings.licenseInstances[settings.licenseKey]
}

/**
 * 取消激活当前的 license
 */
export async function deactivate() {
  const store = getDefaultStore()
  const settings = store.get(settingsAtom)
  // 更新本地状态
  store.set(settingsAtom, (settings) => ({
    ...settings,
    licenseKey: '',
    licenseDetail: undefined,
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
 * @returns
 */
export async function activate(licenseKey: string) {
  const store = getDefaultStore()
  // 取消激活已存在的 license
  const settings = store.get(settingsAtom)
  if (settings.licenseKey) {
    await deactivate()
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
  store.set(settingsAtom, (settings) => {
    const newSettings: Settings = {
      ...settings,
      licenseKey,
      licenseInstances: {
        ...(settings.licenseInstances || {}),
        [licenseKey]: result.instanceId,
      },
      licenseDetail: undefined,
    }
    if (licenseDetail) {
      newSettings.licenseDetail = licenseDetail
    }
    return newSettings
  })
  return result
}
