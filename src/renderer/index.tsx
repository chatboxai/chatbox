import { SplashScreen } from '@capacitor/splash-screen'
import '@mantine/core/styles.css'
import '@mantine/spotlight/styles.css'
import { RouterProvider } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import 'photoswipe/dist/photoswipe.css'
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import i18n from './i18n'
import { getLogger } from './lib/utils'
import platform from './platform'
import reportWebVitals from './reportWebVitals'
import { router } from './router'
import './static/globals.css'
import './static/index.css'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import * as migration from './stores/migration'
import { getMigrationErrorContext } from './stores/migration-error'
import queryClient from './stores/queryClient'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'
import { isRTL } from './utils/rtl'

const log = getLogger('index')

// 按需加载 polyfill
import './setup/load_polyfill'

// GA4 初始化
import './setup/ga_init'

// Show native scrollbars only while scrolling
import './setup/scrollbar_visibility'

// Publish the automation contract version during renderer startup.
import './setup/automation_contract'
// 引入保护代码
import './setup/protect'
import { QueryClientProvider } from '@tanstack/react-query'
import { initJkTracking } from './setup/jk_analytics_init'
import { initPlausibleTracking } from './setup/plausible_init'
import { initSentry } from './setup/sentry_init'
import { initSessionAttachmentRagMaintenance } from './setup/session_attachment_rag_maintenance'
import { initLastUsedModelStore } from './stores/lastUsedModelStore'
import { initOnboardingStore } from './stores/onboardingStore'
import { initLoginLicenseStateReconciliation } from './stores/premiumActions'
import { initRecentDirectoriesStore } from './stores/recentDirectoriesStore'
import { initSettingsStore } from './stores/settingsStore'
import { initUpdateListeners } from './stores/updateStore'
import { reportError } from './utils/sentry'

// 开发环境下引入错误测试工具
// if (process.env.NODE_ENV === 'development') {
//   import('./utils/error-testing')
// }

// Token estimation system initialization (runs in all environments)
import('./setup/token_estimation_init')

// 引入移动端安全区域代码，主要为了解决异形屏幕的问题
if (CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'ios') {
  import('./setup/mobile_safe_area')
}

// ==========执行初始化==============
async function initializeApp() {
  log.info('initializeApp')

  let migrationError: unknown
  try {
    // 数据迁移
    await migration.migrate()
    log.info('migrate done')
  } catch (e) {
    log.error('migrate error', e)
    migrationError = e
  }

  // Migrate persisted consent before any settings-backed telemetry initializes.
  await initSentry()
  void initPlausibleTracking((onResolved) => {
    router.subscribe('onResolved', ({ hrefChanged }) => onResolved(hrefChanged))
  })
  void initJkTracking()

  if (migrationError !== undefined) {
    const migrationErrorContext = getMigrationErrorContext(migrationError)
    reportError(migrationError, {
      domain: 'storage',
      extras: migrationErrorContext ? { ...migrationErrorContext } : undefined,
      operation: 'migration',
      priority: 'high',
      tags: migrationErrorContext ? { configVersion: migrationErrorContext.configVersion } : undefined,
    })
  }

  // 最后执行 storage 清理，清理不 block 进入UI
  import('./setup/storage_clear')

  // 启动mcp服务器
  import('./setup/mcp_bootstrap')
}

// ==========渲染节点==============

function InitPage() {
  const log = useAtomValue(initLogAtom)
  const [showLoadingLog, setShowLoadingLog] = useState(false)
  const migrationProcess = useAtomValue(migrationProcessAtom)

  return (
    <div className="flex flex-col items-center absolute top-0 left-0 w-full h-full">
      <p className="font-roboto font-normal opacity-40 mt-4 mb-2">
        {migrationProcess ? `Migrating...(${migrationProcess})` : 'loading...'}
      </p>
      <div className="">
        <div
          role="button"
          tabIndex={0}
          className="px-4 py-0 rounded-lg cursor-pointer select-none text-sm text-blue-600"
          onClick={() => setShowLoadingLog(!showLoadingLog)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setShowLoadingLog(!showLoadingLog)
              e.preventDefault()
            }
          }}
        >
          {showLoadingLog ? 'Hide Loading Log' : 'Show Loading Log'}
        </div>
      </div>
      {/* 倒叙展示，能够看到最新的日志 */}
      {showLoadingLog && (
        <pre className="whitespace-pre-wrap flex-1 overflow-y-auto m-0 p-2">{[...log].reverse().join('\n')}</pre>
      )}
    </div>
  )
}

// initializeApp执行时间少于1s的话，将不会看到log
const tid = setTimeout(() => {
  ReactDOM.createRoot(document.getElementById('log-root') as HTMLElement).render(
    <StrictMode>
      <ErrorBoundary>
        <InitPage />
      </ErrorBoundary>
    </StrictMode>
  )
  if (platform.type === 'mobile') {
    SplashScreen.hide()
  }
}, 1000)

// 等待初始化完成后再渲染
initializeApp()
  .catch((e) => {
    // 初始化中的各个步骤已经捕获了错误，这里防止未来添加未捕获的逻辑
    reportError(e, {
      domain: 'application',
      handled: false,
      operation: 'app_initialization',
      priority: 'critical',
    })
    log.error('initializeApp error', e)
  })
  .finally(async () => {
    clearTimeout(tid)

    // 等待settings和onboarding初始化完成，避免闪屏
    const [settings] = await Promise.all([
      initSettingsStore(),
      initLastUsedModelStore(),
      initOnboardingStore(),
      initRecentDirectoriesStore(),
    ])








    i18n.changeLanguage(settings.language)

// Automatically set document direction based on selected language
// This enables proper RTL layout mirroring for languages like Persian, Arabic, etc.
document.documentElement.dir = isRTL(settings.language) ? 'rtl' : 'ltr'

// Listen to language changes and update direction dynamically
i18n.on('languageChanged', (lng) => {
  document.documentElement.dir = isRTL(lng) ? 'rtl' : 'ltr'
})







    initLoginLicenseStateReconciliation()

    // Initialize auto-updater event listeners (desktop only, idempotent)
    if (platform.type === 'desktop') {
      initUpdateListeners()
      initSessionAttachmentRagMaintenance()
    }
    // Cleanup is intentionally not captured — listeners persist for the app lifetime

    // 初始化完成，可以开始渲染
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <StrictMode>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ErrorBoundary>
      </StrictMode>
    )

    if (platform.type === 'mobile') {
      SplashScreen.hide()
    }
    const el = document.querySelector('.splash-screen')
    if (el) {
      el.addEventListener('animationend', () => {
        el.parentNode?.removeChild(el)
      })
      el.classList.add('splash-screen-fade-out')
    }

    if (window?.navigator?.storage) {
      navigator.storage?.persisted().then((persisted) => {
        if (!persisted) {
          navigator.storage?.persist()
        }
      })
    }
  })

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
