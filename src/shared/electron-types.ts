export interface ElectronIPC {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  getPathForFile: (file: File) => string
  onSystemThemeChange: (callback: () => void) => () => void
  onWindowMaximizedChanged: (callback: (_: Electron.IpcRendererEvent, windowMaximized: boolean) => void) => () => void
  onWindowShow: (callback: () => void) => () => void
  onWindowFocused: (callback: () => void) => () => void
  onUpdateDownloaded: (callback: () => void) => () => void
  addMcpStdioTransportEventListener: <Args extends unknown[]>(
    transportId: string,
    event: string,
    callback?: (...args: Args) => void
  ) => () => void
  onNavigate: (callback: (path: string) => void) => () => void
  // 内置 skill 后台同步完成（有更新）时由 main 推送，renderer 据此刷新 skill 列表与工具缓存
  onSkillsBuiltinUpdated: (callback: () => void) => () => void

  // Auto-updater events
  onUpdaterChecking: (callback: () => void) => () => void
  onUpdaterAvailable: (callback: (data: { version: string }) => void) => () => void
  onUpdaterNotAvailable: (callback: () => void) => () => void
  onUpdaterProgress: (
    callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  ) => () => void
  onUpdaterDownloaded: (callback: (data: { version: string }) => void) => () => void
  onUpdaterError: (callback: (data: { message: string }) => void) => () => void
}
