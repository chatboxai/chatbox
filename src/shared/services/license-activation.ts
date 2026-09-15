import type { Settings, ChatboxAILicenseDetail } from '../types'

interface LicenseActivationPorts {
  activate(key: string): Promise<{ valid: boolean; instanceId?: string; error?: string }>
  getDetail(
    key: string
  ): Promise<{ detail: ChatboxAILicenseDetail | null; error?: { code?: string; message?: string } }>
}

/** Prepare a complete activation before replacing a host's current credentials. */
export async function prepareLicenseActivation(key: string, ports: LicenseActivationPorts) {
  const licenseKey = key.trim()
  if (!licenseKey) return { valid: false as const, error: 'invalid_license_key' }
  const activation = await ports.activate(licenseKey)
  if (!activation.valid || !activation.instanceId) {
    return { valid: false as const, error: activation.error || 'invalid_license_activation' }
  }
  const result = await ports.getDetail(licenseKey)
  if (result.error || !result.detail) {
    return { valid: false as const, error: result.error?.code || result.error?.message || 'license_detail_unavailable' }
  }
  return { valid: true as const, licenseKey, instanceId: activation.instanceId, detail: result.detail }
}

export function licenseActivationSettings(
  settings: Settings,
  activation: { licenseKey: string; instanceId: string; detail: ChatboxAILicenseDetail },
  method: 'login' | 'manual',
  accountEmail?: string
): Partial<Settings> {
  const { licenseKey, instanceId, detail } = activation
  const instances = { ...settings.licenseInstances }
  if (settings.licenseKey && settings.licenseKey !== licenseKey) delete instances[settings.licenseKey]
  return {
    licenseKey,
    licenseActivationMethod: method,
    licenseInstances: { ...instances, [licenseKey]: instanceId },
    licenseDetail: detail,
    licensePlanName: detail.name,
    hasExpiredLicense: false,
    defaultEmbeddingModel: undefined,
    defaultRerankModel: undefined,
    ...(method === 'manual' ? { memorizedManualLicenseKey: licenseKey } : {}),
    ...(method === 'login' && accountEmail
      ? {
          lastSelectedLicenseByUser: { ...settings.lastSelectedLicenseByUser, [accountEmail]: licenseKey },
        }
      : {}),
  }
}

export function licenseDeactivationSettings(settings: Settings): Partial<Settings> {
  const instances = { ...settings.licenseInstances }
  if (settings.licenseKey) delete instances[settings.licenseKey]
  return {
    licenseKey: undefined,
    licenseActivationMethod: undefined,
    licenseInstances: instances,
    licenseDetail: undefined,
    licensePlanName: undefined,
    hasExpiredLicense: false,
  }
}
