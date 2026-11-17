import { createDefaultSettings } from '@chatbox/core'
import { describe, expect, it, vi } from 'vitest'
import { licenseActivationSettings, licenseDeactivationSettings, prepareLicenseActivation } from './license-activation'

const settings = createDefaultSettings()

describe('prepareLicenseActivation', () => {
  it('rejects an activation that lacks an instance before requesting details', async () => {
    const getDetail = vi.fn()
    expect(await prepareLicenseActivation('key', { activate: async () => ({ valid: true }), getDetail })).toMatchObject(
      { valid: false }
    )
    expect(getDetail).not.toHaveBeenCalled()
  })
  it('rejects a successful activation when the detail request reports expiration', async () => {
    expect(
      await prepareLicenseActivation('key', {
        activate: async () => ({ valid: true, instanceId: 'instance' }),
        getDetail: async () => ({ detail: null, error: { code: 'expired_license' } }),
      })
    ).toEqual({ valid: false, error: 'expired_license' })
  })
})

it('builds credential and account history updates only from complete activation results', () => {
  const current = { ...settings, licenseKey: 'old', licenseInstances: { old: 'old-instance' } }
  const fullDetail = {
    name: 'Pro',
    status: 'active',
    remaining_quota_35: 0,
    remaining_quota_4: 0,
    remaining_quota_image: 0,
    image_used_count: 0,
    image_total_quota: 0,
    plan_image_limit: 0,
    token_refreshed_time: '',
    token_next_refresh_time: '',
    token_expire_time: '',
    remaining_quota_unified: 10,
    expansion_pack_limit: 0,
    expansion_pack_usage: 0,
    unified_token_usage: 0,
    unified_token_limit: 10,
    unified_token_usage_details: [],
    aggregated_reward_details: { type: 'reward', token_usage: 0, token_limit: 0, expires_at: null },
  }
  const next = licenseActivationSettings(
    current,
    { licenseKey: 'new', instanceId: 'new-instance', detail: fullDetail },
    'login',
    'user@example.com'
  )
  expect(next).toMatchObject({
    licenseKey: 'new',
    licenseInstances: { new: 'new-instance' },
    lastSelectedLicenseByUser: { 'user@example.com': 'new' },
  })
  expect(next.licenseInstances).not.toHaveProperty('old')
  expect(current.licenseKey).toBe('old')
  expect(licenseDeactivationSettings({ ...current, ...next })).toMatchObject({
    licenseKey: undefined,
    licenseInstances: {},
    licenseDetail: undefined,
  })
})
