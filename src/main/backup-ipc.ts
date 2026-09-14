import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { BackupFiles } from './backup-files'

export function registerBackupIpc() {
  const files = new BackupFiles(join(app.getPath('userData'), 'chatbox-blobs'))
  const owners = new Set<number>()
  const watch = (sender: Electron.WebContents) => {
    if (owners.has(sender.id)) return
    owners.add(sender.id)
    sender.once('destroyed', () => {
      owners.delete(sender.id)
      void files.closeOwner(sender.id)
    })
    sender.on('render-process-gone', () => {
      void files.closeOwner(sender.id)
    })
  }
  ipcMain.handle('backup:file-open', async (event, filename: string) => {
    if (typeof filename !== 'string' || filename.length > 256) throw new Error('Invalid backup filename')
    const selected = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'Chatbox backup', extensions: ['zip'] }],
    })
    if (selected.canceled || !selected.filePath) return null
    watch(event.sender)
    return files.create(event.sender.id, selected.filePath)
  })
  ipcMain.handle('backup:blob-open', (event, key: string) => {
    watch(event.sender)
    return files.openBlob(event.sender.id, key)
  })
  ipcMain.handle('backup:blob-create', (event, key: string) => {
    watch(event.sender)
    return files.createBlob(event.sender.id, key)
  })
  ipcMain.handle('backup:file-read', (event, token: string, offset: number, length: number) =>
    files.read(event.sender.id, token, offset, length)
  )
  ipcMain.handle('backup:file-write', (event, token: string, bytes: Uint8Array) =>
    files.write(event.sender.id, token, bytes)
  )
  ipcMain.handle('backup:file-finish', (event, token: string, commit: boolean) =>
    files.finish(event.sender.id, token, commit)
  )
}
