import { join } from 'node:path'
import { app, dialog, ipcMain, net } from 'electron'
import { BackupResourceFiles } from './backup-resource-files'
import { DeepSeekDownloads } from './deepseek-download'
import { FileTransfers } from './file-transfers'

export function registerFileTransferIpc() {
  const files = new FileTransfers(join(app.getPath('userData'), 'chatbox-blobs'))
  const backups = new BackupResourceFiles(app.getPath('userData'))
  const downloads = new DeepSeekDownloads(join(app.getPath('temp'), 'chatbox-deepseek-downloads'), (url, init) =>
    net.fetch(url, init)
  )
  const owners = new Set<number>()
  const watch = (sender: Electron.WebContents) => {
    if (owners.has(sender.id)) return
    owners.add(sender.id)
    sender.once('destroyed', () => {
      owners.delete(sender.id)
      void files.closeOwner(sender.id)
      void downloads.closeOwner(sender.id)
    })
    sender.on('render-process-gone', () => {
      void files.closeOwner(sender.id)
      void downloads.closeOwner(sender.id)
    })
  }
  ipcMain.handle('deepseek-download:start', (event, id: string, url: string) => {
    watch(event.sender)
    return downloads.start(event.sender.id, id, url)
  })
  ipcMain.handle('deepseek-download:progress', (event, id: string) => downloads.progress(event.sender.id, id))
  ipcMain.handle('deepseek-download:read', (event, id: string, offset: number, length: number) =>
    downloads.read(event.sender.id, id, offset, length)
  )
  ipcMain.handle('deepseek-download:close', (event, id: string) => downloads.close(event.sender.id, id))
  ipcMain.handle('file-transfer:open-save', async (event, filename: string) => {
    if (typeof filename !== 'string' || filename.length > 256) throw new Error('Invalid filename')
    const selected = await dialog.showSaveDialog({ defaultPath: filename })
    if (selected.canceled || !selected.filePath || event.sender.isDestroyed()) return null
    watch(event.sender)
    return files.create(event.sender.id, selected.filePath)
  })
  ipcMain.handle('file-transfer:open-resource', (event, key: string) => {
    watch(event.sender)
    return files.openResource(event.sender.id, key)
  })
  ipcMain.handle('file-transfer:create-resource', (event, key: string) => {
    watch(event.sender)
    return files.createResource(event.sender.id, key)
  })
  ipcMain.handle('backup-resource:create', async (event, jobId: string, key: string) => {
    watch(event.sender)
    return files.create(event.sender.id, await backups.candidate(jobId, key))
  })
  ipcMain.handle('backup-resource:publish', (_event, jobId: string, key: string) => backups.publish(jobId, key))
  ipcMain.handle('backup-resource:cleanup', (_event, jobId: string) => backups.cleanup(jobId))
  ipcMain.handle('file-transfer:read', (event, token: string, offset: number, length: number) =>
    files.read(event.sender.id, token, offset, length)
  )
  ipcMain.handle('file-transfer:write', (event, token: string, bytes: Uint8Array) =>
    files.write(event.sender.id, token, bytes)
  )
  ipcMain.handle('file-transfer:finish', (event, token: string, commit: boolean) => {
    if (typeof commit !== 'boolean') throw new Error('Invalid file completion')
    return files.finish(event.sender.id, token, commit)
  })
}
