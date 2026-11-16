import type { GenerateImageParams } from '@chatbox/core/application/image-generation'
import NiceModal from '@ebay/nice-modal-react'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { ChatboxAILicenseDetail } from '@shared/types'
import { toast } from 'sonner'
import LinkTargetBlank from '@/components/common/Link'
import i18n from '@/i18n'
import type { ConfirmModalResult } from '@/modals/ConfirmModal'
import { buildChatboxUrl, getChatboxAIModelList, getLicenseDetailRealtime } from '@/packages/remote'
import { settingsStore } from '@/stores/settingsStore'

const checkFailed = () => new Error(i18n.t<string>('Unable to check image billing. Please try again.'))
const cancelled = () => new DOMException('Image generation was cancelled.', 'AbortError')

const workImageApprovals = new Map<string, { active: boolean; alwaysAllow: boolean }>()

function workImageApprovalKey(params: GenerateImageParams, licenseKey: string): string | undefined {
  if (params.source?.type !== 'chatbox_cli') return undefined
  return JSON.stringify({
    licenseKey,
    sessionId: params.source.sessionId,
    toolCallId: params.source.toolCallId,
    provider: params.model.provider,
    modelId: params.model.modelId,
    prompt: params.prompt,
    referenceImages: params.referenceImages,
    count: params.imageGenerateNum || 1,
    aspectRatio: params.aspectRatio === 'auto' ? undefined : params.aspectRatio,
    style: params.dalleStyle,
  })
}

// The reviewed call gets one in-memory permission; tool history never stores billing consent.
export async function withImagePointsApproval(
  params: GenerateImageParams,
  licenseKey: string,
  alwaysAllow: boolean,
  continueGeneration: () => Promise<void>
): Promise<void> {
  const key = workImageApprovalKey(params, licenseKey)
  if (!key || !licenseKey || settingsStore.getState().licenseKey !== licenseKey) throw cancelled()
  const approval = { active: true, alwaysAllow }
  workImageApprovals.set(key, approval)
  const unsubscribe = settingsStore.subscribe((state) => {
    if (state.licenseKey !== licenseKey) approval.active = false
  })
  try {
    await continueGeneration()
  } finally {
    approval.active = false
    if (workImageApprovals.get(key) === approval) workImageApprovals.delete(key)
    unsubscribe()
  }
}

function rememberImagePointsConsent(consentKey: string): void {
  try {
    localStorage.setItem(consentKey, 'true')
  } catch {
    toast.error(i18n.t('Could not save your preference. Permission applies only to this generation.'))
  }
}

function nonnegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw checkFailed()
  return value
}

export function remainingImageQuota(detail: ChatboxAILicenseDetail): number {
  return Math.max(nonnegative(detail.image_total_quota) - nonnegative(detail.image_used_count), 0)
}

export function availableImagePoints(detail: ChatboxAILicenseDetail, now = Date.now()): number {
  if (!Array.isArray(detail.unified_token_usage_details)) throw checkFailed()
  let available = Math.max(nonnegative(detail.expansion_pack_limit) - nonnegative(detail.expansion_pack_usage), 0)
  for (const source of detail.unified_token_usage_details) {
    if (source.expires_at) {
      const expires = Date.parse(source.expires_at)
      if (!Number.isFinite(expires)) throw checkFailed()
      if (expires <= now) continue
    }
    available += Math.max(nonnegative(source.token_limit) - nonnegative(source.token_usage), 0)
  }
  return available
}

const POINTS_PLANS = ['lite', 'pro', 'pro_plus', 'quota_pack']

/** Whether a Chatbox AI image request of `quantity` images exceeds the remaining quota on a paid plan. */
export function imagePointsChargeNeeded(detail: ChatboxAILicenseDetail, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) throw checkFailed()
  if (remainingImageQuota(detail) >= quantity || detail.plan === 'free') return false
  if (!detail.plan || !POINTS_PLANS.includes(detail.plan)) throw checkFailed()
  return true
}

export type ImagePointsCharge = {
  chargedImages: number
  pointsPerImage: number
  totalPoints: number
  availablePoints: number
  sufficient: boolean
}

/** Points spent by a request that `imagePointsChargeNeeded` reports as charged. */
export function getImagePointsCharge(
  detail: ChatboxAILicenseDetail,
  quantity: number,
  pointsPerImage: number | undefined
): ImagePointsCharge {
  if (pointsPerImage === undefined || !Number.isSafeInteger(pointsPerImage) || pointsPerImage <= 0) {
    throw checkFailed()
  }
  const chargedImages = quantity - remainingImageQuota(detail)
  const totalPoints = chargedImages * pointsPerImage
  const availablePoints = availableImagePoints(detail)
  return { chargedImages, pointsPerImage, totalPoints, availablePoints, sufficient: availablePoints >= totalPoints }
}

// Separate browser storage is device-local and is not included in settings backup/sync.
export async function imagePointsConsentKey(licenseKey: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey))
  return `image-points-consent:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function readImagePointsConsent(consentKey: string): boolean {
  try {
    return localStorage.getItem(consentKey) === 'true'
  } catch {
    return false
  }
}

export async function hasImagePointsConsent(licenseKey: string): Promise<boolean> {
  return readImagePointsConsent(await imagePointsConsentKey(licenseKey))
}

export async function refreshImageLicense(licenseKey: string, signal?: AbortSignal): Promise<ChatboxAILicenseDetail> {
  const { data, error } = await getLicenseDetailRealtime({ licenseKey }, signal)
  if (!data) {
    const remoteError = error?.code ? ChatboxAIAPIError.fromCodeName('', error.code) : null
    throw remoteError || checkFailed()
  }
  if (settingsStore.getState().licenseKey === licenseKey) settingsStore.setState({ licenseDetail: data })
  return data
}

export async function authorizeImagePoints(
  params: GenerateImageParams,
  signal: AbortSignal,
  interactive: boolean
): Promise<void> {
  if (params.model.provider !== 'chatbox-ai') return
  const licenseKey = settingsStore.getState().licenseKey
  if (!licenseKey) throw checkFailed()
  const assertCurrent = () => {
    if (signal.aborted || settingsStore.getState().licenseKey !== licenseKey) throw cancelled()
  }
  assertCurrent()
  const workApprovalKey = workImageApprovalKey(params, licenseKey)
  const workApproval = workApprovalKey ? workImageApprovals.get(workApprovalKey) : undefined
  if (workApprovalKey) workImageApprovals.delete(workApprovalKey)
  const consentKey = await imagePointsConsentKey(licenseKey)
  assertCurrent()
  if (readImagePointsConsent(consentKey)) return
  const detail = await refreshImageLicense(licenseKey, signal)
  assertCurrent()
  const quantity = params.imageGenerateNum || 1
  if (!imagePointsChargeNeeded(detail, quantity)) return
  const remaining = remainingImageQuota(detail)
  const models = await getChatboxAIModelList({ licenseKey, language: settingsStore.getState().language }, signal)
  assertCurrent()
  const price = models.imageModels.find((model) => model.modelId === params.model.modelId)?.points_per_image
  if (!getImagePointsCharge(detail, quantity, price).sufficient) {
    throw ChatboxAIAPIError.fromCodeName('', 'image_points_insufficient') || checkFailed()
  }
  if (workApproval?.active) {
    if (workApproval.alwaysAllow) rememberImagePointsConsent(consentKey)
    return
  }
  if (!interactive) {
    throw new Error(
      i18n.t<string>('Allow compute points billing in the image creator on this device before using this command.')
    )
  }
  const dialogController = new AbortController()
  const abort = () => dialogController.abort()
  const unsubscribe = settingsStore.subscribe((state) => {
    if (state.licenseKey !== licenseKey) abort()
  })
  signal.addEventListener('abort', abort, { once: true })
  try {
    assertCurrent()
    const locale = i18n.language.startsWith('zh') ? 'zh' : 'en'
    const result = await NiceModal.show<ConfirmModalResult>('image-points-confirm', {
      signal: dialogController.signal,
      title: i18n.t('Use compute points to generate images?'),
      message: (
        <>
          {remaining > 0
            ? i18n.t('Your image quota is insufficient. Additional images will use compute points from your plan.')
            : i18n.t('Your image quota is used up. Continuing will use compute points from your plan.')}
          <br />
          {i18n.t('For detailed points usage, see')}{' '}
          <LinkTargetBlank href={buildChatboxUrl(`/${locale}/model-pricing#image-models`)}>
            {i18n.t('Model pricing')}
          </LinkTargetBlank>
        </>
      ),
      confirmText: i18n.t('Continue generating'),
      dontShowAgainText: i18n.t('Always allow this license to use compute points for images on this device'),
    })
    assertCurrent()
    if (!result) throw cancelled()
    if (typeof result === 'object' && result.dontShowAgain) {
      rememberImagePointsConsent(consentKey)
    }
  } finally {
    signal.removeEventListener('abort', abort)
    unsubscribe()
  }
}
