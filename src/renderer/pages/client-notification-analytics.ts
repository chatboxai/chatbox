import { trackJkClickEvent, trackJkViewEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import type { ClientNotification } from '@/packages/remote'

export function trackClientNotificationImpression(notification: ClientNotification) {
  trackJkViewEvent(JK_EVENTS.NOTIFICATION_IMPRESSION, {
    pageName: JK_PAGE_NAMES.CLIENT_NOTIFICATION_DIALOG,
    content: notification.batch_id,
    contentType: notification.content_language,
  })
}

export function trackClientNotificationLinkClick(notification: ClientNotification) {
  trackJkClickEvent(JK_EVENTS.NOTIFICATION_LINK_CLICK, {
    pageName: JK_PAGE_NAMES.CLIENT_NOTIFICATION_DIALOG,
    content: notification.batch_id,
    contentType: notification.content_language,
    contentPosition: 'body_link',
  })
}
