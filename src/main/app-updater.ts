import { autoUpdater } from 'electron-updater'
import { getSettings } from './store-node'
import { getLogger } from './util'

const log = getLogger('app-updater')

export class AppUpdater {
  constructor(onUpdateDownloaded: () => void) {
    log.transports.file.level = 'info'
    autoUpdater.logger = log

    autoUpdater.once('update-downloaded', (event) => {
      // Notify renderer process about the update
      onUpdateDownloaded()
    })
    const settings = getSettings()
    if (settings.autoUpdate) {
      // 立即检查一次更新
      this.tryUpdate()

      // 设置定时器，每小时检查一次更新
      setInterval(
        () => {
          this.tryUpdate()
        },
        1000 * 60 * 60
      ) // 每小时检查一次

      log.info('Update timer started, checking every hour')
    }
  }

  async tryUpdate() {
    const feedUrls = [
      'https://chatboxai.app/api/auto_upgrade',
      'https://api.chatboxai.app/api/auto_upgrade',
      'https://api.ai-chatbox.com/api/auto_upgrade',
      'https://api.chatboxapp.xyz/api/auto_upgrade',
      'https://api.chatboxai.com/api/auto_upgrade',
    ]
    for (const url of feedUrls) {
      try {
        autoUpdater.setFeedURL(url)
        const settings = getSettings()

        if (settings.betaUpdate) {
          autoUpdater.channel = 'beta'
          autoUpdater.allowDowngrade = false
        }
        const result = await autoUpdater.checkForUpdatesAndNotify()
        if (result) {
          return result
        }
      } catch (e) {
        log.error(`auto_updater: attempt failed: ${url}. `, e)
      }
    }
    return null
  }
}
