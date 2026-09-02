import { SplashScreen } from '@capacitor/splash-screen'
import { ChatboxProvider } from '@chatbox/react'
import '@mantine/core/styles.css'
import '@mantine/spotlight/styles.css'
import { RouterProvider } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import 'photoswipe/dist/photoswipe.css'
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { bootstrapRenderer, initializeRenderer, rendererApplication, reportRendererInitializationError } from './app'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import platform from './platform'
import reportWebVitals from './reportWebVitals'
import { router } from './router'
import './static/globals.css'
import './static/index.css'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'

// 按需加载 polyfill
import './setup/load_polyfill'

// Publish the automation contract version during renderer startup.
import './setup/automation_contract'
// 引入保护代码
import './setup/protect'

// 开发环境下引入错误测试工具
// if (process.env.NODE_ENV === 'development') {
//   import('./utils/error-testing')
// }

// Token estimation system initialization (runs in all environments)
void import('./setup/token_estimation_init')

// 引入移动端安全区域代码，主要为了解决异形屏幕的问题
if (CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'ios') {
  void import('./setup/mobile_safe_area')
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
    void SplashScreen.hide()
  }
}, 1000)

// 等待初始化完成后再渲染
initializeRenderer()
  .catch((error) => {
    // 初始化中的各个步骤已经捕获了错误，这里防止未来添加未捕获的逻辑
    reportRendererInitializationError(error)
  })
  .finally(async () => {
    clearTimeout(tid)

    // 等待settings和onboarding初始化完成，避免闪屏
    await bootstrapRenderer(rendererApplication)
    // Cleanup is intentionally not captured — listeners persist for the app lifetime

    // 初始化完成，可以开始渲染
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <StrictMode>
        <ErrorBoundary>
          <ChatboxProvider application={rendererApplication}>
            <RouterProvider router={router} />
          </ChatboxProvider>
        </ErrorBoundary>
      </StrictMode>
    )

    if (platform.type === 'mobile') {
      void SplashScreen.hide()
    }
    const el = document.querySelector('.splash-screen')
    if (el) {
      const removeSplashScreen = () => el.remove()
      el.addEventListener('animationend', removeSplashScreen, { once: true })
      el.classList.add('splash-screen-fade-out')
      // Some embedded WebEngines apply the class but never dispatch animationend.
      // Never leave the initialized application permanently covered by the splash screen.
      setTimeout(removeSplashScreen, 600)
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
