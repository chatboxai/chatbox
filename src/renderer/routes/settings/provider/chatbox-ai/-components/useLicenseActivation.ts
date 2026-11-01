import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRefreshChatboxAIModelsOnLicenseChange } from '@/hooks/useChatboxAIModels'
import { getLicenseDetailRealtime, type LicenseDetailError } from '@/packages/remote'
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

  const { data: licenseDetailResponse, error: queryError } = useQuery({
    queryKey: ['license-detail', memorizedManualLicenseKey],
    queryFn: async () => {
      const res = await getLicenseDetailRealtime({ licenseKey: memorizedManualLicenseKey })
      return res
    },
    enabled: !!memorizedManualLicenseKey && activated,
  })

  const licenseDetail = licenseDetailResponse?.data
  // 合并两种错误来源：1) API 返回 200 但带有 error 字段  2) API 返回 4xx/5xx 被 ofetch 抛出
  const licenseDetailError: LicenseDetailError | undefined =
    licenseDetailResponse?.error || (queryError as any)?.data?.error || (queryError as any)?.error

  useRefreshChatboxAIModelsOnLicenseChange(memorizedManualLicenseKey, licenseDetailError ? undefined : licenseDetail)

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
    } catch (e: unknown) {
      // 提取具体的错误信息：API 返回的 error 对象或通用错误消息
      const err = e as { data?: { error?: { detail?: string } }; message?: string }
      const errorDetail = err?.data?.error?.detail || err?.message || 'Unknown error'
      setActivateError(errorDetail)
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
      activate()
    }

    // Update ref to track the current value
    prevKeyRef.current = memorizedManualLicenseKey
  }, [memorizedManualLicenseKey, activate, settings.licenseInstances, isDeactivating, activated])

  return {
    memorizedManualLicenseKey,
    setMemorizedManualLicenseKey,
    licenseDetail,
    licenseDetailError,
    activated,
    activating,
    activateError,
    activate,
    deactivate,
    isDeactivating,
    setIsDeactivating,
  }
}
