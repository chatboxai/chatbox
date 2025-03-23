import { PlatformInterface } from '@/packages/platform.interface'

export class MobilePlatform implements PlatformInterface {
    public constructor() {}

    public async shouldUseDarkColors(): Promise<boolean> {
        return false
    }

    public async onSystemThemeChange(callback: () => void): Promise<void> {
        return
    }

    public onWindowShow(callback: () => void): () => void {
        // const unlisten = Event.listen('tauri://focus', callback);
        // return () => unlisten.then(f => f());
        return () => {}
    }
}
