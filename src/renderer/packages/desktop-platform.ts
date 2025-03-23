import { getCurrentWindow } from '@tauri-apps/api/window'
import { PlatformInterface } from '@/packages/platform.interface'

export class DesktopPlatform implements PlatformInterface {

    public constructor() {}

    public async shouldUseDarkColors(): Promise<boolean> {
        const theme = await getCurrentWindow().theme();
        return 'dark' === theme
    }

    public async onSystemThemeChange(callback: () => void): Promise<() => void> {
        return await getCurrentWindow().onThemeChanged(callback);
    }

    public onWindowShow(callback: () => void): () => void {
        // const unlisten = Event.listen('tauri://focus', callback);
        // return () => unlisten.then(f => f());
        return () => {}
    }
}