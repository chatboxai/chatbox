// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { type GenerateImageParams, ImageGenerationService } from '@chatbox/core/application/image-generation'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { ChatboxAILicenseDetail, ImageGeneration } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  resolve: vi.fn(),
  hide: vi.fn(),
  detail: vi.fn(),
  models: vi.fn(),
  state: { licenseKey: 'license-a', language: 'en' },
  setState: vi.fn(),
  subscribe: vi.fn((_listener: (state: { licenseKey: string }) => void) => vi.fn()),
}))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: mocks.show, resolve: mocks.resolve, hide: mocks.hide } }))
vi.mock('@/components/common/Link', () => ({ default: () => null }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'zh-Hans' } }))
vi.mock('@/packages/remote', () => ({
  getLicenseDetailRealtime: mocks.detail,
  getChatboxAIModelList: mocks.models,
  buildChatboxUrl: (path: string) => `https://chatboxai.app${path}`,
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => mocks.state,
    setState: mocks.setState,
    subscribe: mocks.subscribe,
  },
}))

import {
  authorizeImagePoints,
  availableImagePoints,
  getImagePointsCharge,
  hasImagePointsConsent,
  imagePointsChargeNeeded,
  imagePointsConsentKey,
  withImagePointsApproval,
} from './image-points-billing'

const params: GenerateImageParams = {
  prompt: 'cat',
  referenceImages: [],
  model: { provider: 'chatbox-ai', modelId: 'image' },
}
function detail(patch: Partial<ChatboxAILicenseDetail> = {}): ChatboxAILicenseDetail {
  return {
    plan: 'pro',
    image_total_quota: 100,
    image_used_count: 100,
    unified_token_usage_details: [{ type: 'plan', token_limit: 100000, token_usage: 0 }],
    expansion_pack_limit: 0,
    expansion_pack_usage: 0,
    ...patch,
  } as ChatboxAILicenseDetail
}
const run = (patch: Partial<GenerateImageParams> = {}) =>
  authorizeImagePoints({ ...params, ...patch }, new AbortController().signal, true)
const workParams: GenerateImageParams = {
  ...params,
  source: { type: 'chatbox_cli', sessionId: 'session', toolCallId: 'tool' },
}
const runWork = (request = workParams) => authorizeImagePoints(request, new AbortController().signal, false)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  mocks.state.licenseKey = 'license-a'
  mocks.detail.mockResolvedValue({ data: detail() })
  mocks.models.mockResolvedValue({ imageModels: [{ modelId: 'image', points_per_image: 27000 }] })
  mocks.show.mockResolvedValue({ confirmed: true, dontShowAgain: false })
})

describe('image points authorization', () => {
  it('reads saved permission for the matching license and fails closed if storage is unavailable', async () => {
    localStorage.setItem(await imagePointsConsentKey('license-a'), 'true')
    expect(await hasImagePointsConsent('license-a')).toBe(true)
    expect(await hasImagePointsConsent('license-b')).toBe(false)
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    try {
      expect(await hasImagePointsConsent('license-a')).toBe(false)
    } finally {
      read.mockRestore()
    }
  })

  it('bypasses BYOK and uses remaining images or Free without a confirmation', async () => {
    await run({ model: { provider: 'openai', modelId: 'image' } })
    expect(mocks.detail).not.toHaveBeenCalled()
    mocks.detail.mockResolvedValueOnce({ data: detail({ image_used_count: 99 }) })
    await run()
    mocks.detail.mockResolvedValueOnce({ data: detail({ plan: 'free' }) })
    await run()
    expect(mocks.models).not.toHaveBeenCalled()
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('asks again for one-time consent, but remembers always only for this license', async () => {
    await run()
    await run()
    expect(mocks.show).toHaveBeenCalledTimes(2)
    mocks.show.mockResolvedValueOnce({ confirmed: true, dontShowAgain: true })
    await run()
    await run()
    expect(mocks.show).toHaveBeenCalledTimes(3)
    expect(mocks.detail).toHaveBeenCalledTimes(3)
    expect(await imagePointsConsentKey('license-a')).not.toContain('license-a')
    mocks.state.licenseKey = 'license-b'
    await run()
    expect(mocks.show).toHaveBeenCalledTimes(4)
  })
  it('cancels without persisting permission and cancels if the license changes', async () => {
    mocks.show.mockResolvedValueOnce(false)
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(localStorage.length).toBe(0)
    mocks.show.mockImplementationOnce(async () => {
      mocks.state.licenseKey = 'license-b'
      return { confirmed: true, dontShowAgain: true }
    })
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(localStorage.length).toBe(0)
  })
  it('charges only images beyond remaining quota and rejects insufficient points before confirmation', async () => {
    mocks.detail.mockResolvedValue({
      data: detail({ image_used_count: 99, expansion_pack_limit: 27000, unified_token_usage_details: [] }),
    })
    await run({ imageGenerateNum: 2 })
    expect(mocks.show).toHaveBeenCalledOnce()
    await expect(run({ imageGenerateNum: 3 })).rejects.toBeInstanceOf(ChatboxAIAPIError)
    expect(mocks.show).toHaveBeenCalledOnce()
  })
  it('fails closed for missing or zero price and missing balances', async () => {
    mocks.models.mockResolvedValueOnce({ imageModels: [{ modelId: 'image' }] })
    await expect(run()).rejects.toThrow('Unable to check')
    mocks.detail.mockResolvedValueOnce({ data: detail({ expansion_pack_usage: undefined }) })
    await expect(run()).rejects.toThrow('Unable to check')
    expect(mocks.show).not.toHaveBeenCalled()
    mocks.models.mockResolvedValueOnce({ imageModels: [{ modelId: 'image', points_per_image: 0 }] })
    await expect(run()).rejects.toThrow('Unable to check')
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('counts each positive source and expansion balance once, excluding expired sources', () => {
    expect(
      availableImagePoints(
        detail({
          unified_token_limit: 999999,
          unified_token_usage: 0,
          unified_token_usage_details: [
            { type: 'plan', token_limit: 100, token_usage: 150 },
            { type: 'reward', token_limit: 80, token_usage: 10 },
            { type: 'expired', token_limit: 100, token_usage: 0, expires_at: '2020-01-01T00:00:00Z' },
          ],
          expansion_pack_limit: 50,
          expansion_pack_usage: 20,
        })
      )
    ).toBe(100)
  })
  it('does not prompt for a CLI request and returns a useful error instead', async () => {
    await expect(authorizeImagePoints(params, new AbortController().signal, false)).rejects.toThrow('image creator')
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('allows an interactive retry to confirm a record originally created by CLI', async () => {
    await run({ source: { type: 'chatbox_cli', sessionId: 's', toolCallId: 't' } })
    expect(mocks.show).toHaveBeenCalledOnce()
    expect(localStorage.length).toBe(0)
  })
  it('uses the work-mode approval once without a second dialog or permanent consent', async () => {
    await withImagePointsApproval(workParams, 'license-a', false, async () => {
      await runWork()
      await expect(runWork()).rejects.toThrow('image creator')
    })
    expect(mocks.show).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    await run()
    expect(mocks.show).toHaveBeenCalledOnce()
  })
  it.each([
    { aspectRatio: 'auto', alwaysAllow: false },
    { aspectRatio: 'auto', alwaysAllow: true },
    { aspectRatio: undefined, alwaysAllow: false },
    { aspectRatio: '16:9', alwaysAllow: false },
  ])('preserves work approval through service normalization: %j', async ({ aspectRatio, alwaysAllow }) => {
    let record: ImageGeneration | null = null
    const completed = {
      task_id: 'task',
      is_finished: true,
      items: [{ uuid: 'image', status: 'completed' as const, image_url: 'https://images.test/cat.png' }],
    }
    const submit = vi.fn().mockResolvedValue(completed)
    const service = new ImageGenerationService({
      storage: {
        initialize: async () => {},
        create: async (value) => {
          record = value
        },
        update: async (_id, updates) => {
          record = record ? { ...record, ...updates } : null
          return record
        },
        getById: async () => record,
        delete: async () => {
          record = null
        },
        getPage: async () => ({ items: [], total: 0, nextCursor: null }),
        getTotal: async () => (record ? 1 : 0),
      },
      blobStorage: { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [] },
      asyncClient: { submit, poll: vi.fn().mockResolvedValue(completed) },
      createModel: vi.fn(),
      resolveReferenceImage: async () => null,
      authorizeRequest: authorizeImagePoints,
    })
    const request = { ...workParams, aspectRatio }
    await withImagePointsApproval(request, 'license-a', alwaysAllow, async () => {
      const handle = await service.start(request)
      await expect(handle.completion).resolves.toMatchObject({ status: 'done' })
    })
    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        aspect_ratio: aspectRatio === 'auto' ? undefined : aspectRatio,
      })
    )
    expect(mocks.show).not.toHaveBeenCalled()
    expect(localStorage.getItem(await imagePointsConsentKey('license-a'))).toBe(alwaysAllow ? 'true' : null)
    if (alwaysAllow) await run()
    else await expect(runWork(request)).rejects.toThrow('image creator')
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('shares always-allow consent in both directions between work mode and image creator', async () => {
    await withImagePointsApproval(workParams, 'license-a', true, async () => {
      expect(localStorage.length).toBe(0)
      await runWork()
    })
    expect(localStorage.getItem(await imagePointsConsentKey('license-a'))).toBe('true')
    await run()
    expect(mocks.show).not.toHaveBeenCalled()

    localStorage.clear()
    mocks.show.mockResolvedValueOnce({ confirmed: true, dontShowAgain: true })
    await run()
    await runWork()
    expect(mocks.show).toHaveBeenCalledOnce()
    mocks.state.licenseKey = 'license-b'
    await expect(runWork()).rejects.toThrow('image creator')
  })
  it.each<[string, Partial<ChatboxAILicenseDetail>]>([
    ['remaining image quota covers the request', { image_used_count: 99 }],
    ['the plan is Free', { plan: 'free' }],
  ])('does not remember work-mode always-allow when %s', async (_case, patch) => {
    mocks.detail.mockResolvedValue({ data: detail(patch) })
    await withImagePointsApproval(workParams, 'license-a', true, () => runWork())
    expect(localStorage.length).toBe(0)
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('computes the points charge only for images beyond the remaining quota', () => {
    const pro = detail({ image_used_count: 99, expansion_pack_limit: 27000, unified_token_usage_details: [] })
    expect(imagePointsChargeNeeded(pro, 1)).toBe(false)
    expect(imagePointsChargeNeeded(detail({ plan: 'free' }), 1)).toBe(false)
    expect(imagePointsChargeNeeded(pro, 3)).toBe(true)
    expect(getImagePointsCharge(pro, 3, 27000)).toEqual({
      chargedImages: 2,
      pointsPerImage: 27000,
      totalPoints: 54000,
      availablePoints: 27000,
      sufficient: false,
    })
    expect(getImagePointsCharge(pro, 2, 27000)).toMatchObject({
      chargedImages: 1,
      totalPoints: 27000,
      sufficient: true,
    })
    expect(() => getImagePointsCharge(pro, 2, 0)).toThrow('Unable to check')
  })
  it('does not authorize another tool call or changed image request', async () => {
    await withImagePointsApproval(workParams, 'license-a', false, async () => {
      for (const patch of [
        { source: { type: 'chatbox_cli' as const, sessionId: 'session', toolCallId: 'other' } },
        { source: { type: 'chatbox_cli' as const, sessionId: 'other', toolCallId: 'tool' } },
        { prompt: 'different' },
        { imageGenerateNum: 2 },
        { referenceImages: ['picture:other'] },
        { aspectRatio: '16:9' },
        { dalleStyle: 'natural' as const },
      ]) {
        await expect(runWork({ ...workParams, ...patch })).rejects.toThrow('image creator')
      }
      await runWork()
    })
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('cleans up unused permission when continuation fails or the license changes', async () => {
    await expect(
      withImagePointsApproval(workParams, 'license-a', true, () => Promise.reject(new Error('continuation failed')))
    ).rejects.toThrow('continuation failed')
    expect(localStorage.length).toBe(0)
    await expect(runWork()).rejects.toThrow('image creator')
    await withImagePointsApproval(workParams, 'license-a', true, async () => {
      const onSettingsChange = mocks.subscribe.mock.calls.at(-1)?.[0]
      onSettingsChange?.({ licenseKey: 'license-b' })
      await expect(runWork()).rejects.toThrow('image creator')
    })
    const resume = vi.fn()
    await expect(withImagePointsApproval(workParams, 'license-b', true, resume)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(resume).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
  it('keeps balance validation and abort handling before consuming work-mode points', async () => {
    mocks.detail.mockResolvedValueOnce({ data: detail({ unified_token_usage_details: [] }) })
    await expect(withImagePointsApproval(workParams, 'license-a', true, () => runWork())).rejects.toBeInstanceOf(
      ChatboxAIAPIError
    )
    expect(localStorage.length).toBe(0)
    const controller = new AbortController()
    controller.abort()
    await expect(
      withImagePointsApproval(workParams, 'license-a', true, () =>
        authorizeImagePoints(workParams, controller.signal, false)
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(localStorage.length).toBe(0)
    await expect(runWork()).rejects.toThrow('image creator')
  })
  it('retains one-time work consent when saving always-allow fails', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage unavailable')
    })
    try {
      await withImagePointsApproval(workParams, 'license-a', true, () => runWork())
      expect(localStorage.length).toBe(0)
      expect(mocks.show).not.toHaveBeenCalled()
      await expect(runWork()).rejects.toThrow('image creator')
    } finally {
      setItem.mockRestore()
    }
  })
  it('honors cancellation while loading quota', async () => {
    const controller = new AbortController()
    mocks.detail.mockImplementationOnce(async () => {
      controller.abort()
      return { data: detail() }
    })
    await expect(authorizeImagePoints(params, controller.signal, true)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.show).not.toHaveBeenCalled()
  })
})
