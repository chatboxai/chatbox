// import { session } from 'electron'
// import * as store from './store-node'
//
// export function init() {
//     const { proxy } = store.getSettings()
//     if (proxy) {
//         ensure(proxy)
//     }
// }
//
// export function ensure(proxy?: string) {
//     if (proxy) {
//         session.defaultSession.setProxy({ proxyRules: proxy })
//     } else {
//         session.defaultSession.setProxy({})
//     }
// }
