import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLicenseDetailRealtime } from '@/packages/remote'
import * as premiumActions from '@/stores/premiumActions'
import { settingsStore } from '@/stores/settingsStore'

interface Settings {
  licenseKey?: string
  licenseInstances?: Record<string, any>
  memorizedManualLicenseKey?: string
  licenseActivationMethod?: 'login' | 'manual'
}

interface UseLicenseActivationParams {
  settings: Settings
  onActivationSuccess?: () => void
}

export function useLicenseActivation({ settings, onActivationSuccess }: UseLicenseActivationParams) {
  const [memorizedManualLicenseKey, setMemorizedManualLicenseKey] = useState(settings.memorizedManualLicenseKey || '')

  // Track previous key value to detect user input
  const prevKeyRef = useRef(memorizedManualLicenseKey)

  // Sync memorizedManualLicenseKey to settings
  useEffect(() => {
    if (memorizedManualLicenseKey !== settings.memorizedManualLicenseKey) {
      settingsStore.setState({ memorizedManualLicenseKey })
    }
  }, [memorizedManualLicenseKey, settings.memorizedManualLicenseKey])
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState<string | undefined>()

  // 只有当是 manual 方式激活时才认为"已激活"，避免登录&手动使用同一个 license 时 UI 显示错误
  const autoValidated = premiumActions.useAutoValidate()
  // 兼容旧版本：如果没有 licenseActivationMethod 但有 licenseKey，也认为是 manual 模式
  const activated =
    autoValidated &&
    ((settings as any).licenseActivationMethod === 'manual' ||
      (!(settings as any).licenseActivationMethod && !!(settings as any).licenseKey))

  const { data: licenseDetail } = useQuery({
    queryKey: ['license-detail', memorizedManualLicenseKey],
    queryFn: async () => {
      const res = await getLicenseDetailRealtime({ licenseKey: memorizedManualLicenseKey })
      return res
    },
    enabled: !!memorizedManualLicenseKey && activated,
  })

  const activate = useCallback(async () => {
    try {
      setActivating(true)
      setActivateError(undefined)
      const result = await premiumActions.activate(memorizedManualLicenseKey || '', 'manual')
      if (!result.valid) {
        setActivateError(result.error)
      } else {
        onActivationSuccess?.()
      }
    } catch (e: any) {
      setActivateError(e?.message || 'unknow error')
    } finally {
      setActivating(false)
    }
  }, [memorizedManualLicenseKey, onActivationSuccess])

  const deactivate = useCallback(async () => {
    try {
      setIsDeactivating(true)
      await premiumActions.deactivate()
    } finally {
      setIsDeactivating(false)
    }
  }, [])

  // Auto-activate when license key is entered by user
  useEffect(() => {
    // Only trigger auto-activation when key actually changes (user input)
    const isUserInput = memorizedManualLicenseKey !== prevKeyRef.current && memorizedManualLicenseKey.length >= 36

    if (!isDeactivating && isUserInput && !settings.licenseInstances?.[memorizedManualLicenseKey] && !activated) {
      console.log('auto activate')
      activate()
    }

    // Update ref to track the current value
    prevKeyRef.current = memorizedManualLicenseKey
  }, [memorizedManualLicenseKey, activate, settings.licenseInstances, isDeactivating, activated])

  return {
    memorizedManualLicenseKey,
    setMemorizedManualLicenseKey,
    licenseDetail,
    activated,
    activating,
    activateError,
    activate,
    deactivate,
    isDeactivating,
    setIsDeactivating,
  }
}
