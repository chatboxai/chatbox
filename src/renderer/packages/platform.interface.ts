

export interface PlatformInterface {
    shouldUseDarkColors(): Promise<boolean>
    onSystemThemeChange(callback: () => void): Promise<void>
    onWindowShow(callback: () => void): () => void
}