import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getQuitAndInstallArguments } from './installer-command'
import { getSettings } from './store-node'
import { getLogger } from './util'

const log = getLogger('app-updater')

function sendToRenderer(win: BrowserWindow | null, channel: string, data?: unknown) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export class AppUpdater {
  private getWindow: () => BrowserWindow | null
  private isChecking = false
  private suppressError = false

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow

    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      sendToRenderer(this.getWindow(), 'updater:checking')
    })

    autoUpdater.on('update-available', (info) => {
      sendToRenderer(this.getWindow(), 'updater:available', { version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      sendToRenderer(this.getWindow(), 'updater:not-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      sendToRenderer(this.getWindow(), 'updater:progress', {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer(this.getWindow(), 'updater:downloaded', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      log.error('auto_updater error:', err)
      // Suppress error events during feed URL fallback to avoid false error flashes
      if (!this.suppressError) {
        sendToRenderer(this.getWindow(), 'updater:error', { message: err?.message || 'Unknown error' })
      }
    })

    // Guard against double-registration (defensive — AppUpdater is singleton)
    ipcMain.removeHandler('updater:check')
    ipcMain.handle('updater:check', async () => {
      if (this.isChecking) return { started: false }
      try {
        const result = await this.tryUpdate()
        // electron-updater returns null without firing events in dev mode or when all URLs fail
        if (!result) sendToRenderer(this.getWindow(), 'updater:not-available')
      } catch (e) {
        log.error('auto_updater: check failed', e)
        sendToRenderer(this.getWindow(), 'updater:error', {
          message: e instanceof Error ? e.message : 'Unknown error',
        })
      }
      return { started: true }
    })

    ipcMain.removeHandler('install-update')
    ipcMain.handle('install-update', () => {
      autoUpdater.quitAndInstall(...getQuitAndInstallArguments(process.platform))
    })

    const settings = getSettings()
    if (settings.autoUpdate) {
      setTimeout(() => this.tryUpdate().catch((e) => log.error('auto_updater: startup check failed', e)), 5_000)
      setInterval(
        () => this.tryUpdate().catch((e) => log.error('auto_updater: scheduled check failed', e)),
        1000 * 60 * 60
      )
      log.info('Update timer started, checking every hour')
    }
  }

  async tryUpdate() {
    if (this.isChecking) {
      log.info('auto_updater: check already in progress, skipping')
      return null
    }

    this.isChecking = true
    try {
      const feedUrls = [
        'https://chatboxai.app/api/auto_upgrade',
        'https://api.chatboxai.app/api/auto_upgrade',
        'https://api.ai-chatbox.com/api/auto_upgrade',
        'https://api.chatboxapp.xyz/api/auto_upgrade',
        'https://api.chatboxai.com/api/auto_upgrade',
      ]

      const settings = getSettings()
      autoUpdater.channel = settings.betaUpdate ? 'beta' : 'latest'
      autoUpdater.allowDowngrade = false

      let lastError: Error | null = null
      for (const url of feedUrls) {
        try {
          autoUpdater.setFeedURL(url)
          // Suppress error events from failed URLs — only the final error matters
          this.suppressError = true
          const result = await autoUpdater.checkForUpdates()
          this.suppressError = false
          // The download rejects separately from the update check. The updater's
          // error event already reports the failure to the renderer.
          void result?.downloadPromise?.catch(() => {})
          return result
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e))
          log.error(`auto_updater: attempt failed: ${url}. `, e)
        }
      }
      this.suppressError = false
      // All URLs failed — throw so callers handle it (don't return null, which would be misread as "no update")
      if (lastError) throw lastError
      return null
    } finally {
      this.isChecking = false
      this.suppressError = false
    }
  }
}
