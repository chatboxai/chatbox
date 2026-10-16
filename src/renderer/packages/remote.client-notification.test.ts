import { beforeEach, describe, expect, it, vi } from 'vitest'

const ofetchMock = vi.hoisted(() => vi.fn())

vi.mock('ofetch', () => ({ ofetch: ofetchMock }))
vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    getPlatform: vi.fn().mockResolvedValue('web'),
    getVersion: vi.fn().mockResolvedValue('web'),
  },
}))
vi.mock('@/stores/authInfoStore', () => ({
  authInfoStore: {
    getState: () => ({ getTokens: () => null }),
  },
}))

import { getNextClientNotification } from './remote'

describe('getNextClientNotification', () => {
  beforeEach(() => ofetchMock.mockReset())

  it.each([undefined, 'https://assets.chatboxai.app/notifications/cover.png'])(
    'preserves optional cover %s and sends locale and batch history',
    async (cover_image_url) => {
      const response = {
        data: {
          batch_id: '018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc41',
          title: '更新说明',
          subtitle: '1.22 版本',
          body_markdown: '本次更新内容',
          content_language: 'zh',
          cover_image_url,
        },
      }
      ofetchMock.mockResolvedValue(response)

      await expect(
        getNextClientNotification({
          locale: 'zh-Hant',
          displayed_batch_ids: ['018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc40'],
        })
      ).resolves.toEqual(response.data)

      expect(ofetchMock).toHaveBeenCalledWith(
        'https://api.chatboxai.app/api/client_notifications/next',
        expect.objectContaining({
          body: {
            locale: 'zh-Hant',
            displayed_batch_ids: ['018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc40'],
          },
          method: 'POST',
          retry: 0,
        })
      )
    }
  )
})
