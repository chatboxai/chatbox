import { describe, expect, it } from 'vitest'
import {
  bucketPlausibleCount,
  normalizePlausibleModel,
  normalizePlausiblePath,
  normalizePlausibleProvider,
  normalizePlausibleUrl,
  normalizePlausibleVersion,
} from './plausible'

describe('Plausible dimensions', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2_5'],
    [5, '2_5'],
    [6, '6_plus'],
  ])('buckets count %s as %s', (count, expected) => {
    expect(bucketPlausibleCount(count)).toBe(expected)
  })

  it('groups patch and prerelease versions by major and minor', () => {
    expect(normalizePlausibleVersion('1.22.3-beta.1')).toBe('1.22')
    expect(normalizePlausibleVersion('unknown')).toBe('unknown')
  })

  it('keeps stable built-in provider and model dimensions', () => {
    expect(normalizePlausibleProvider('openai')).toBe('openai')
    expect(normalizePlausibleModel('openai', 'gpt-5.4')).toBe('gpt-5.4')
    expect(normalizePlausibleModel('openai', 'private-model-name')).toBe('custom')
    expect(normalizePlausibleModel('chatbox-ai', 'chatboxai-runtime-model')).toBe('chatboxai-runtime-model')
  })

  it('groups custom providers and models', () => {
    expect(normalizePlausibleProvider('custom-provider-private')).toBe('custom')
    expect(normalizePlausibleModel('custom-provider-private', 'private-model-name')).toBe('custom')
  })
})

describe('normalizePlausiblePath', () => {
  it('groups session pages without retaining the session ID', () => {
    expect(normalizePlausiblePath('/session/session-123')).toBe('/session/:sessionId')
  })

  it('keeps built-in provider IDs for provider-level analytics', () => {
    expect(normalizePlausiblePath('/settings/provider/openai')).toBe('/settings/provider/openai')
    expect(normalizePlausiblePath('/settings/provider/github-copilot')).toBe('/settings/provider/github-copilot')
  })

  it('groups custom provider pages without retaining the custom provider ID', () => {
    expect(normalizePlausiblePath('/settings/provider/my-private-provider')).toBe('/settings/provider/:providerId')
  })

  it('keeps static routes unchanged', () => {
    expect(normalizePlausiblePath('/settings/general')).toBe('/settings/general')
  })
})

describe('normalizePlausibleUrl', () => {
  it('normalizes dynamic routes in an Electron hash URL', () => {
    expect(normalizePlausibleUrl('file:///Applications/Chatbox/index.html#/session/session-123')).toBe(
      'file:///Applications/Chatbox/index.html#/session/:sessionId'
    )
  })

  it('normalizes dynamic routes in a web URL', () => {
    expect(normalizePlausibleUrl('https://web.chatboxai.app/session/session-123')).toBe(
      'https://web.chatboxai.app/session/:sessionId'
    )
  })

  it('removes internal search parameters without exposing the route ID', () => {
    expect(normalizePlausibleUrl('https://app.chatboxai.app/#/session/session-123?settings=%2Fsettings')).toBe(
      'https://app.chatboxai.app/#/session/:sessionId'
    )
  })

  it('keeps supported attribution parameters', () => {
    expect(
      normalizePlausibleUrl('https://web.chatboxai.app/session/session-123?utm_source=newsletter&settings=%2Fsettings')
    ).toBe('https://web.chatboxai.app/session/:sessionId?utm_source=newsletter')
  })
})
