import { describe, expect, it, vi } from 'vitest'

const analytics = vi.hoisted(() => ({ click: vi.fn(), view: vi.fn() }))

vi.mock('@/analytics/jk', () => ({
  trackJkClickEvent: analytics.click,
  trackJkViewEvent: analytics.view,
}))

import type { ClientNotification } from '@/packages/remote'
import { trackClientNotificationImpression, trackClientNotificationLinkClick } from './client-notification-analytics'

const notification: ClientNotification = {
  batch_id: '018f6f6e-7c8f-7b0e-a3f2-2f6e1bf6dc41',
  title: '更新说明',
  body_markdown: '[详情](https://chatboxai.app/help?secret=value)',
  content_language: 'zh',
}

describe('client notification analytics', () => {
  it('reports only the batch, language and stable link position', () => {
    trackClientNotificationImpression(notification)
    trackClientNotificationLinkClick(notification)

    expect(analytics.view).toHaveBeenCalledWith('notification_impression', {
      pageName: 'client_notification_dialog',
      content: notification.batch_id,
      contentType: 'zh',
    })
    expect(analytics.click).toHaveBeenCalledWith('notification_link_click', {
      pageName: 'client_notification_dialog',
      content: notification.batch_id,
      contentType: 'zh',
      contentPosition: 'body_link',
    })
    expect(JSON.stringify([...analytics.view.mock.calls, ...analytics.click.mock.calls])).not.toContain('secret=value')
  })
})
