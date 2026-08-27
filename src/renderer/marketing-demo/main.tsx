import '@mantine/core/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { rendererApplication } from '@/app/renderer-application'
import i18n from '@/i18n'
import { postDemoError } from '@/marketing-demo/bridge'
import { DemoApp } from '@/marketing-demo/DemoApp'
import { DemoProviders } from '@/marketing-demo/DemoProviders'
import { seedDemoBlobs } from '@/marketing-demo/demo-assets'
import { applyDemoLayout, setForcedDemoLayout } from '@/marketing-demo/demo-layout'
import { seedDemoSessions } from '@/marketing-demo/demo-sessions'
import { parseDemoSearch } from '@/marketing-demo/protocol'
import '@/modals'
import '@/static/globals.css'
import '@/static/index.css'

async function start(): Promise<void> {
  const { lang, layout } = parseDemoSearch(window.location.search)
  const resolvedLayout = layout ?? (window.innerWidth < 600 ? 'mobile' : 'desktop')
  setForcedDemoLayout(layout)
  applyDemoLayout(resolvedLayout)
  await rendererApplication.bootstrap()
  rendererApplication.settingsStore.setState((state) => {
    state.language = lang
    state.allowReportingAndTracking = false
  })
  await i18n.changeLanguage(lang)
  await seedDemoBlobs()
  await seedDemoSessions(lang)

  const root = document.getElementById('root')
  if (!root) throw new Error('marketing demo root is missing')
  createRoot(root).render(
    <StrictMode>
      <DemoProviders>
        <DemoApp />
      </DemoProviders>
    </StrictMode>
  )
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  postDemoError(message)
  console.error(error)
})
