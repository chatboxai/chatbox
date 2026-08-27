import { ChatboxProvider } from '@chatbox/react'
import NiceModal from '@ebay/nice-modal-react'
import { colorsTuple, MantineProvider } from '@mantine/core'
import { getDefaultInterfaceColors, resolveInterfaceBrandColor } from '@shared/theme-colors'
import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { AppProviders } from '@/components/AppProviders'
import { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import { DemoMuiTheme } from '@/marketing-demo/DemoChrome'

const lightColors = getDefaultInterfaceColors().light

const chatboxColors = {
  'chatbox-brand': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-brand)')),
  'chatbox-gray': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-gray)')),
  'chatbox-success': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-success)')),
  'chatbox-error': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-error)')),
  'chatbox-warning': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-warning)')),
  'chatbox-primary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-primary)')),
  'chatbox-secondary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-secondary)')),
  'chatbox-tertiary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-tertiary)')),
}

function LightThemeVars() {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', 'light')
    root.setAttribute('data-mantine-color-scheme', 'light')
    root.classList.remove('dark')
    const brand = resolveInterfaceBrandColor(lightColors.brand, 'light')
    root.style.setProperty('--chatbox-background-primary', lightColors.backgroundPrimary)
    root.style.setProperty('--chatbox-background-secondary', lightColors.backgroundSecondary)
    root.style.setProperty('--chatbox-background-tertiary', lightColors.backgroundTertiary)
    root.style.setProperty('--chatbox-brand', brand)
  }, [])
  return null
}

export function DemoProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={{
        primaryColor: 'chatbox-brand',
        defaultRadius: 'lg',
        colors: chatboxColors,
        components: {
          Text: { defaultProps: { c: 'chatbox-primary' } },
          Title: { defaultProps: { c: 'chatbox-primary' } },
        },
      }}
      defaultColorScheme="light"
      forceColorScheme="light"
    >
      <ChatboxProvider application={rendererApplication}>
        <AppProviders>
          <DemoMuiTheme>
            <NiceModal.Provider>
              <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
                <LightThemeVars />
                {children}
              </BlockCodeCollapsedStateProvider>
            </NiceModal.Provider>
          </DemoMuiTheme>
        </AppProviders>
      </ChatboxProvider>
    </MantineProvider>
  )
}
