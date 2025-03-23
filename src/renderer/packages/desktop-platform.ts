import { getCurrentWindow } from '@tauri-apps/api/window'
import { PlatformInterface } from '@/packages/platform.interface'

export class DesktopPlatform implements PlatformInterface {
    public constructor() {}

    public async shouldUseDarkColors(): Promise<boolean> {
        // const theme = await getCurrentWindow().theme()
        // return 'dark' === theme
        return false;
    }

    public async onSystemThemeChange(callback: () => void): Promise<void> {
        // const unlisted = await getCurrentWindow().onThemeChanged(({ payload: theme }) => {
        //     callback()
        // })
        // return unlisted()
        return
    }

    public onWindowShow(callback: () => void): () => void {
        // const unlisten = Event.listen('tauri://focus', callback);
        // return () => unlisten.then(f => f());
        return () => {}
    }
}