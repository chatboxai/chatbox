import { app } from 'electron'
import { ofetch } from 'ofetch'
import { type AnalyticsEventParams, GOOGLE_ANALYTICS_MEASUREMENT_ID } from '../shared/analytics'
import * as store from './store-node'

// Measurement Protocol 参考文档
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?hl=zh-cn&client_type=gtag
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag&hl=zh-cn#required_parameters

// 事件名、参数名，必须是字母、数字、下划线的组合

const api_secret = `3H5zJ3WTSAm-4jOajRDP7A`

function getAnalyticsOperatingSystem(params: AnalyticsEventParams): string {
  const platform = typeof params.chatbox_platform === 'string' ? params.chatbox_platform : process.platform
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      // gtag 在 web/mobile 端自动采集的 macOS 取值是 'Macintosh'，保持同一维度值避免报表分裂
      return 'Macintosh'
    case 'linux':
      return 'Linux'
    case 'harmony':
      return 'HarmonyOS'
    default:
      return platform
  }
}

export async function event(name: string, params: AnalyticsEventParams = {}) {
  const clientId = store.getConfig().uuid
  const res = await ofetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}&api_secret=${api_secret}`,
    {
      method: 'POST',
      body: {
        user_id: clientId,
        client_id: clientId,
        device: {
          category: 'desktop',
          operating_system: getAnalyticsOperatingSystem(params),
        },
        events: [
          {
            name: name,
            params: {
              app_name: 'chatbox',
              app_version: app.getVersion(),
              chatbox_platform_type: 'desktop',
              chatbox_platform: process.platform,
              app_platform: process.platform,
              ...params,
            },
          },
        ],
      },
    }
  )
  return res
}
