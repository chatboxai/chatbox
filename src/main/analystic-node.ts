import { app } from 'electron'
import { ofetch } from 'ofetch'

// https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?hl=zh-cn&client_type=gtag
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag&hl=zh-cn#required_parameters

const measurement_id = `G-T6Q7MNPNLK`
const api_secret = `pRnsvLo-REWLVzV_PbKvWg`

export async function event(name: string, params: any = {}) {
    // const clientId = store.getConfig().uuid
    // const res = await ofetch(
    //     `https://www.google-analytics.com/mp/collect?measurement_id=${measurement_id}&api_secret=${api_secret}`,
    //     {
    //         method: 'POST',
    //         body: {
    //             user_id: clientId,
    //             client_id: clientId,
    //             events: [
    //                 {
    //                     name: name,
    //                     params: {
    //                         app_name: 'chatbox',
    //                         app_version: app.getVersion(),
    //                         chatbox_platform_type: 'desktop',
    //                         chatbox_platform: 'desktop',
    //                         app_platform: process.platform,
    //                         ...params,
    //                     },
    //                 },
    //             ],
    //         },
    //     }
    // )
    // return res
}
