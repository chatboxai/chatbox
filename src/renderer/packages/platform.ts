import { getVersion } from '@tauri-apps/api/app'
import { hostname, platform } from '@tauri-apps/plugin-os'
import { invoke } from '@tauri-apps/api/core'
import { Config, Settings } from 'src/shared/types'
import { LazyStore } from '@tauri-apps/plugin-store'
import { getOS } from './navigator'
import { parseLocale } from '@/i18n/parser'
import Exporter from './exporter'
import * as defaults from '../../shared/defaults'
import { MobilePlatform } from '@/packages/mobile-platform'
import { DesktopPlatform } from '@/packages/desktop-platform'

const store = new LazyStore("settings.json");

export class BasePlatform {
    public exporter = new Exporter();
    private mobile = new MobilePlatform();
    private desktop = new DesktopPlatform();


    public async getVersion(): Promise<string> {
        return getVersion();
    }

    public async getPlatform(): Promise<string> {
        return platform()
    }

    public async isMobile(): Promise<boolean> {
        return await invoke('is_mobile_platform')
    }

    public async shouldUseDarkColors(): Promise<boolean> {
        // if (getOS() === 'Android') {
            return this.mobile.shouldUseDarkColors()
        // }
       // return this.desktop.shouldUseDarkColors();
    }

    public async onSystemThemeChange(callback: () => void): Promise<void> {
        // if (getOS() === 'Android') {
            return this.mobile.onSystemThemeChange(callback)
        // }
       // return this.desktop.onSystemThemeChange(callback)
    }

    public onWindowShow(callback: () => void): () => void {
        // if (getOS() === 'Android') {
            return this.mobile.onWindowShow(callback)
        // }
        // return this.desktop.onWindowShow(callback);
    }

    public async openLink(url: string): Promise<void> {
        return invoke('open_link', { url });
    }

    public async getInstanceName(): Promise<string> {
        return `${await hostname()} / ${getOS()}`;
    }

    public async getLocale() {
        return parseLocale(navigator.language);
    }

    public async ensureShortcutConfig(config: { disableQuickToggleShortcut: boolean }): Promise<void> {
        return invoke('ensure_shortcut_config', { config });
    }

    public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
        return invoke('ensure_proxy_config', { config });
    }

    public async relaunch(): Promise<void> {
        return invoke('relaunch_app');
    }

    public async getConfig(): Promise<Config> {
        try {
            const config = await store.get<Config>('configs');
            return config ?? await this.createDefaultConfig();
        } catch (error) {
            console.error('Config load failed, using defaults', error);
            return this.createDefaultConfig();
        }
    }
    private async createDefaultConfig(): Promise<Config> {
        const defaultConfig = defaults.newConfigs();
        await this.setStoreValue("configs", defaultConfig);
        return defaultConfig;
    }


    public async getSettings(): Promise<Settings> {
        try {
            const setting = await store.get<Settings>('settings');
            return setting ?? await this.createDefaultSettings()
        } catch (error) {
            console.error('Config load failed, using defaults', error);
            return this.createDefaultSettings();
        }
    }

    private async createDefaultSettings(): Promise<Settings> {
        const setting = defaults.settings();
        await this.setStoreValue("settings", setting);
        return setting;
    }

    public async setStoreValue(key: string, value: any) {
         await store.set(key,value);
         return await store.save()
    }
    public async getStoreValue(key: string) {
        return await store.get(key);
    }

    public delStoreValue(key: string) {
        return store.delete(key);
    }

    public async getAllStoreValues(): Promise<{ [key: string]: any }> {
        return await store.entries()
    }

    public async setAllStoreValues(data: { [key: string]: any }) {
        return "unsupported store values";
    }

    public initTracking(): void {
        this.trackingEvent('user_engagement', {});
    }

    public trackingEvent(name: string, params: { [key: string]: string }) {
        // return invoke('tracking_event', { name, params });
    }

    public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
        return invoke('should_show_about_on_startup');
    }

    public async appLog(level: string, message: string) {
        // return invoke('app_log', { level, message });
    }
}

export default new BasePlatform();
