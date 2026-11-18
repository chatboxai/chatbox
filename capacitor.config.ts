import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Local Android shell for the Chatbox renderer (open build).
 *
 * The renderer is compiled with CHATBOX_BUILD_TARGET=mobile_app and
 * CHATBOX_BUILD_PLATFORM=android, so it talks to the Capacitor plugins that
 * this project installs (sqlite, filesystem, haptics, ...).
 */
const config: CapacitorConfig = {
  appId: 'com.chatbox.open',
  appName: 'Chatbox',
  webDir: 'release/app/dist/renderer',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
