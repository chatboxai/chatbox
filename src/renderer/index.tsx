import * as Sentry from '@sentry/react'
import { useAtomValue } from 'jotai'
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import { cn, getLogger } from './lib/utils'
import reportWebVitals from './reportWebVitals'
import { initData } from './setup/init_data'
import './static/globals.css'
import './static/index.css'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import * as migration from './stores/migration'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'
import { router } from './router'
import { RouterProvider } from '@tanstack/react-router'
import '@mantine/core/styles.css'
import '@mantine/spotlight/styles.css'

const log = getLogger('index')

// 按需加载 polyfill
import './setup/load_polyfill'

// Sentry 初始化
import './setup/sentry_init'

// GA4 初始化
import './setup/ga_init'

// 引入保护代码
import './setup/protect'

// 引入移动端安全区域代码，主要为了解决异形屏幕的问题
if (CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'ios') {
  import('./setup/mobile_safe_area')
}

// ==========执行初始化==============
async function initializeApp() {
  log.info('initializeApp')

  try {
    // 数据迁移
    await migration.migrate()
    log.info('migrate done')
  } catch (e) {
    log.error('migrate error', e)
    Sentry.captureException(e as Error)
  }

  try {
    // migration 中没有写入 Demo session了，可以在 migration 之后初始化
    // 初始化数据
    await initData()
    log.info('init data done')
  } catch (e) {
    log.error('init data error', e)
    Sentry.captureException(e as Error)
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
    <div className={cn('flex flex-col justify-center items-center', showLoadingLog ? 'pt-3' : 'h-80')}>
      <div className={cn('flex flex-col items-center', showLoadingLog ? 'hidden' : '')}>
        <h1 className="font-roboto font-bold text-3xl m-0">Chatbox</h1>
        <p className="font-roboto font-normal opacity-40">
          {migrationProcess ? `Migrating...(${migrationProcess})` : 'loading...'}
        </p>
      </div>
      <div className="mt-4">
        <div
          role="button"
          tabIndex={0}
          className="px-4 py-2 rounded-md cursor-pointer select-none text-sm text-blue-600 hover:bg-blue-100 active:bg-blue-200"
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
      {showLoadingLog && <pre className="whitespace-pre-wrap">{[...log].reverse().join('\n')}</pre>}
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <StrictMode>
    <InitPage />
  </StrictMode>
)

// 等待初始化完成后再渲染
initializeApp()
  .catch((e) => {
    // 初始化中的各个步骤已经捕获了错误，这里防止未来添加未捕获的逻辑
    Sentry.captureException(e)
    log.error('initializeApp error', e)
  })
  .finally(() => {
    // 初始化完成，可以开始渲染
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  })

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
