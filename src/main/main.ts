/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import os from 'os'
import path from 'path'
import { app, BrowserWindow, shell, ipcMain, nativeTheme, session, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import MenuBuilder from './menu'
import { resolveHtmlPath } from './util'
import Locale from './locales'
import { store, getConfig, getSettings } from './store-node'
import * as proxy from './proxy'
import * as fs from 'fs-extra'
import * as analystic from './analystic-node'
// Add app.isQuitting property to the Electron.App interface
declare global {
    namespace Electron {
        interface App {
            isQuitting?: boolean;
        }
    }
}
import sanitizeFilename from 'sanitize-filename'

if (process.platform === 'win32') {
    app.setAppUserModelId(app.name)
}

class AppUpdater {
    constructor() {
        log.transports.file.level = 'info'
        const locale = new Locale()

        autoUpdater.logger = log
        autoUpdater.setFeedURL('https://chatboxai.app/api/auto_upgrade/open-source')
        autoUpdater.checkForUpdatesAndNotify()
        autoUpdater.once('update-downloaded', (event) => {
            dialog
                .showMessageBox({
                    type: 'info',
                    buttons: [locale.t('Restart'), locale.t('Later')],
                    title: locale.t('App_Update'),
                    message: event.releaseName || locale.t('New_Version'),
                    detail: locale.t('New_Version_Downloaded'),
                })
                .then((returnValue) => {
                    if (returnValue.response === 0) autoUpdater.quitAndInstall()
                })
        })
    }
}

let mainWindow: BrowserWindow | null = null

if (process.env.NODE_ENV === 'production') {
    const sourceMapSupport = require('source-map-support')
    sourceMapSupport.install()
}

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
    require('electron-debug')()
}

// const installExtensions = async () => {
//     const installer = require('electron-devtools-installer')
//     const forceDownload = !!process.env.UPGRADE_EXTENSIONS
//     const extensions = ['REACT_DEVELOPER_TOOLS']

//     return installer
//         .default(
//             extensions.map((name) => installer[name]),
//             forceDownload
//         )
//         .catch(console.log)
// }

const createWindow = async () => {
    if (isDebug) {
    }

    const RESOURCES_PATH = app.isPackaged
        ? path.join(process.resourcesPath, 'assets')
        : path.join(__dirname, '../../assets')

    const getAssetPath = (...paths: string[]): string => {
        return path.join(RESOURCES_PATH, ...paths)
    }

    mainWindow = new BrowserWindow({
        show: false,
        width: 1000,
        height: 950,
        icon: getAssetPath('icon.png'),
        webPreferences: {
            spellcheck: true,
            webSecurity: false,
            allowRunningInsecureContent: false,
            preload: app.isPackaged
                ? path.join(__dirname, 'preload.js')
                : path.join(__dirname, '../../.erb/dll/preload.js'),
        },
    })

    mainWindow.loadURL(resolveHtmlPath('index.html'))

    mainWindow.on('ready-to-show', () => {
        if (!mainWindow) {
            throw new Error('"mainWindow" is not defined')
        }
        if (process.env.START_MINIMIZED) {
            mainWindow.minimize()
        } else {
            mainWindow.show()
        }
    })

    mainWindow.on('closed', () => {
        mainWindow = null
    })

    const menuBuilder = new MenuBuilder(mainWindow)
    menuBuilder.buildMenu()

    // Open urls in the user's browser
    mainWindow.webContents.setWindowOpenHandler((edata) => {
        shell.openExternal(edata.url)
        return { action: 'deny' }
    })

    // https://www.computerhope.com/jargon/m/menubar.htm
    mainWindow.setMenuBarVisibility(false)

    // Remove this if your app does not use auto updates
    // eslint-disable-next-line
    new AppUpdater()

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
            },
        })
    })

    nativeTheme.on('updated', () => {
        mainWindow?.webContents.send('system-theme-updated')
    })
}

/**
 * Add event listeners...
 */

// Function to safely quit the app after cleanup
const safeQuit = () => {
    // Mark app as quitting to prevent new network requests
    app.isQuitting = true;
    
    // Only quit when no pending analytics requests
    if (analystic.pendingRequests === 0) {
        app.quit();
    } else {
        // Wait a bit and check again
        setTimeout(() => safeQuit(), 100);
    }
}

// Handle the 'before-quit' event
app.on('before-quit', (event) => {
    // If app is already in quitting state, don't prevent
    if (app.isQuitting && analystic.pendingRequests === 0) {
        return;
    }
    
    // Prevent the default quit
    event.preventDefault();
    
    // Use our safe quit procedure instead
    safeQuit();
});

app.on('window-all-closed', () => {
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    if (process.platform !== 'darwin') {
        safeQuit();
    }
})

app.whenReady()
    .then(() => {
        createWindow()
        app.on('activate', () => {
            // On macOS it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
            if (mainWindow === null) createWindow()
        })
        proxy.init()
    })
    .catch((error) => {
        // Use electron-log instead of console.log to avoid EPIPE errors
        log.error('App initialization error:', error)
    })

// IPC

ipcMain.handle('getStoreValue', (event, key) => {
    return store.get(key)
})
ipcMain.handle('setStoreValue', (event, key, dataJson) => {
    const data = JSON.parse(dataJson)
    return store.set(key, data)
})
ipcMain.handle('delStoreValue', (event, key) => {
    return store.delete(key)
})
ipcMain.handle('getAllStoreValues', (event) => {
    return JSON.stringify(store.store)
})
ipcMain.handle('setAllStoreValues', (event, dataJson) => {
    const data = JSON.parse(dataJson)
    store.store = data
})

ipcMain.handle('getVersion', () => {
    return app.getVersion()
})
ipcMain.handle('getPlatform', () => {
    return process.platform
})
ipcMain.handle('getHostname', () => {
    return os.hostname()
})
ipcMain.handle('getLocale', () => {
    try {
        return app.getLocale()
    } catch (e: any) {
        return ''
    }
})
ipcMain.handle('openLink', (event, link) => {
    return shell.openExternal(link)
})

ipcMain.handle('shouldUseDarkColors', () => nativeTheme.shouldUseDarkColors)

ipcMain.handle('ensureProxy', (event, json) => {
    const config: { proxy?: string } = JSON.parse(json)
    proxy.ensure(config.proxy)
})

ipcMain.handle('relaunch', () => {
    app.relaunch()
    app.quit()
})

ipcMain.handle('analysticTrackingEvent', (event, dataJson) => {
    // Skip analytics if app is quitting
    if (app.isQuitting) {
        return;
    }
    
    try {
        const data = JSON.parse(dataJson);
        // Don't await this promise to avoid blocking
        analystic.event(data.name, data.params).catch((e) => {
            log.error('analystic_tracking_event', e);
        });
    } catch (e) {
        log.error('analystic_tracking_event_parse', e);
    }
})

ipcMain.handle('getConfig', (event) => {
    return getConfig()
})

ipcMain.handle('getSettings', (event) => {
    return getSettings()
})

ipcMain.handle('shouldShowAboutDialogWhenStartUp', (event) => {
    const currentVersion = app.getVersion()
    if (store.get('lastShownAboutDialogVersion', '') === currentVersion) {
        return false
    }
    store.set('lastShownAboutDialogVersion', currentVersion)
    return true
})

ipcMain.handle('appLog', (event, dataJson) => {
    const data: { level: string; message: string } = JSON.parse(dataJson)
    data.message = 'APP_LOG: ' + data.message
    switch (data.level) {
        case 'info':
            log.info(data.message)
            break
        case 'error':
            log.error(data.message)
            break
        default:
            log.info(data.message)
    }
})
