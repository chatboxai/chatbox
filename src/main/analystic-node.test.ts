import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConfigMock, getVersionMock, ofetchMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getVersionMock: vi.fn(),
  ofetchMock: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getVersion: getVersionMock,
  },
}))
vi.mock('ofetch', () => ({
  ofetch: ofetchMock,
}))
vi.mock('./store-node', () => ({
  getConfig: getConfigMock,
}))

import { event } from './analystic-node'

const osByPlatform: Record<string, string> = {
  win32: 'Windows',
  darwin: 'Macintosh',
  linux: 'Linux',
}

describe('main-process analytics', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    getVersionMock.mockReset()
    ofetchMock.mockReset()
    getConfigMock.mockReturnValue({ uuid: 'installation-uuid' })
    getVersionMock.mockReturnValue('1.2.3')
    ofetchMock.mockResolvedValue(undefined)
  })

  it('uses the desktop operating system as the default analytics platform', async () => {
    await event('app_open', { session_id: 123 })

    expect(ofetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://www.google-analytics.com/mp/collect'),
      expect.objectContaining({
        body: expect.objectContaining({
          device: {
            category: 'desktop',
            operating_system: osByPlatform[process.platform],
          },
          events: [
            {
              name: 'app_open',
              params: expect.objectContaining({
                chatbox_platform_type: 'desktop',
                chatbox_platform: process.platform,
                app_platform: process.platform,
              }),
            },
          ],
        }),
      })
    )
  })

  it('allows Harmony builds to override the operating-system dimension', async () => {
    await event('app_open', {
      session_id: 123,
      chatbox_platform_type: 'desktop',
      chatbox_platform: 'harmony',
    })

    const request = ofetchMock.mock.calls[0][1]
    expect(request.body.events[0].params).toEqual(
      expect.objectContaining({
        chatbox_platform_type: 'desktop',
        chatbox_platform: 'harmony',
        app_platform: process.platform,
      })
    )
    expect(request.body.device).toEqual({
      category: 'desktop',
      operating_system: 'HarmonyOS',
    })
  })

  it.each(Object.entries(osByPlatform))(
    'maps %s to the GA operating-system dimension',
    async (platform, operatingSystem) => {
      await event('app_open', { chatbox_platform: platform })

      const request = ofetchMock.mock.calls[0][1]
      expect(request.body.device).toEqual({
        category: 'desktop',
        operating_system: operatingSystem,
      })
    }
  )
})
