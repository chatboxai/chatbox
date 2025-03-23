// import log from 'electron-log'
// import Store from 'electron-store'
// import { Config, Settings } from '../shared/types'
// import * as defaults from '../shared/defaults'
//
// interface StoreType {
//     settings: Settings
//     configs: Config
//     lastShownAboutDialogVersion: string
// }
//
// export const store = new Store<StoreType>({
//     clearInvalidConfig: true,
// })
// log.info('store path:', store.path)
//
// export function getSettings(): Settings {
//     const settings = store.get<'settings'>('settings', defaults.settings())
//     return settings
// }
//
// export function getConfig(): Config {
//     let configs = store.get<'configs'>('configs')
//     if (!configs) {
//         configs = defaults.newConfigs()
//         store.set<'configs'>('configs', configs)
//     }
//     return configs
// }
