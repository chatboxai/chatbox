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
import { router } from './router'
import './static/globals.css'
import './static/index.css'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import * as migration from './stores/migration'
import queryClient from './stores/queryClient'

const log = getLogger('index')

// SEC-3: route cross-origin fetches through the main-process net proxy
// (desktop only). Must be installed before any provider/network call.
import './setup/net_proxy_fetch'

// 全局错误处理
import './setup/global_error_handler'

import { QueryClientProvider } from '@tanstack/react-query'
import { initSessionAttachmentRagMaintenance } from './setup/session_attachment_rag_maintenance'
import { ensureChatSearchBackfill } from './stores/chatSearchIndexing'
import { initLastUsedModelStore } from './stores/lastUsedModelStore'
import { initRecentDirectoriesStore } from './stores/recentDirectoriesStore'
import { initSettingsStore } from './stores/settingsStore'

// Token estimation system initialization (runs in all environments)
void import('./setup/token_estimation_init')

// ==========执行初始化==============
async function initializeApp() {
  log.info('initializeApp')

  try {
    // 数据迁移
    await migration.migrate()
    log.info('migrate done')
  } catch (e) {
    log.error('migrate error', e)
  }

  // 启动mcp服务器
  void import('./setup/mcp_bootstrap')
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
          className="px-4 py-0 rounded-md cursor-pointer select-none text-sm text-blue-600"
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
}, 1000)

// 等待初始化完成后再渲染
initializeApp()
  .catch((e) => {
    // 初始化中的各个步骤已经捕获了错误，这里防止未来添加未捕获的逻辑
    log.error('initializeApp error', e)
  })
  .finally(async () => {
    clearTimeout(tid)

    // 等待settings和onboarding初始化完成，避免闪屏
    const [settings] = await Promise.all([initSettingsStore(), initLastUsedModelStore(), initRecentDirectoriesStore()])

    void i18n.changeLanguage(settings.language)
    initSessionAttachmentRagMaintenance()
    ensureChatSearchBackfill()
    window.location.hash = '/'

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
