import { describe, expect, it } from 'vitest'
import { canUseChatboxCloudBrowserApis, isOfficialChatboxWebHost, shouldEnableChatboxBrowserTelemetry } from './chatbox-cloud-runtime'

describe('chatbox cloud runtime guards', () => {
  it('recognizes official Chatbox web hosts', () => {
    expect(isOfficialChatboxWebHost('chatboxai.app')).toBe(true)
    expect(isOfficialChatboxWebHost('beta.chatboxai.app')).toBe(true)
    expect(isOfficialChatboxWebHost('chatbox-web-two.vercel.app')).toBe(false)
  })

  it('fails closed for preview web shells without explicit API overrides', () => {
    expect(
      canUseChatboxCloudBrowserApis({
        buildPlatform: 'web',
        hostname: 'chatbox-web-two.vercel.app',
      })
    ).toBe(false)
  })

  it('keeps cloud APIs enabled for official web shells', () => {
    expect(
      canUseChatboxCloudBrowserApis({
        buildPlatform: 'web',
        hostname: 'chatboxai.app',
      })
    ).toBe(true)
  })

  it('allows explicit beta or local overrides on preview shells', () => {
    expect(
      canUseChatboxCloudBrowserApis({
        buildPlatform: 'web',
        hostname: 'chatbox-web-two.vercel.app',
        useBetaApi: '1',
      })
    ).toBe(true)
  })

  it('only enables browser telemetry on official web shells', () => {
    expect(
      shouldEnableChatboxBrowserTelemetry({
        buildPlatform: 'web',
        hostname: 'chatbox-web-two.vercel.app',
      })
    ).toBe(false)

    expect(
      shouldEnableChatboxBrowserTelemetry({
        buildPlatform: 'web',
        hostname: 'chatboxai.app',
      })
    ).toBe(true)
  })
})
