import { Capacitor, registerPlugin } from '@capacitor/core'

export type AppIconName = 'default' | 'FlatGradient' | 'Sculpted'

export interface AppIconState {
  supported: boolean
  icon: string
}

interface AppIconPlugin {
  getIcon(): Promise<AppIconState>
  setIcon(options: { icon: AppIconName }): Promise<void>
}

export const AppIcon = registerPlugin<AppIconPlugin>('AppIcon')
export const canChangeAppIcon = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
