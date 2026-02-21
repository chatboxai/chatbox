export interface DesktopIPC {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  onSystemThemeChange: (callback: () => void) => () => void
  onWindowMaximizedChanged: (callback: (_event: unknown, windowMaximized: boolean) => void) => () => void
  onWindowShow: (callback: () => void) => () => void
  onWindowFocused: (callback: () => void) => () => void
  onUpdateDownloaded: (callback: () => void) => () => void
  addMcpStdioTransportEventListener: (
    transportId: string,
    event: string,
    callback?: (...args: any[]) => void
  ) => () => void
  onNavigate: (callback: (path: string) => void) => () => void
}
