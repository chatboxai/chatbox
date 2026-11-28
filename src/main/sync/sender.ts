import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, type IpcMainInvokeEvent, type WebContents } from 'electron'

export function isSyncSender(event: IpcMainInvokeEvent, contents: WebContents | undefined): boolean {
  const frame = event.senderFrame
  if (!contents || contents.isDestroyed() || event.sender !== contents || !frame || frame !== contents.mainFrame) {
    return false
  }
  const entry =
    (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) ||
    pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
  const actual = URL.parse(frame.url)
  const expected = new URL(entry)
  return (
    actual?.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname
  )
}
