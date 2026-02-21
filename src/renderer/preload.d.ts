import type { DesktopIPC } from '../shared/desktop-ipc-types'

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    desktopAPI: DesktopIPC
  }
}
