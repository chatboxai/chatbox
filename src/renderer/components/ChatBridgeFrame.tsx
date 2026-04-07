import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { createMessageHandler } from '../packages/chatbridge/message-handler'
import { chatBridgeController } from '../packages/chatbridge/controller'
import { authStore, API_BASE } from '../stores/authStore'
import { chatBridgeStore } from '../stores/chatBridgeStore'

const READY_TIMEOUT_MS = 5_000
const TOOL_TIMEOUT_MS = 60_000

/** Resolve a possibly-relative app URL to an absolute one.
 *  In dev the Express server runs on port 3000 while Vite/Electron runs elsewhere.
 *  VITE_CHATBRIDGE_SERVER_URL can be set to override (e.g. http://localhost:3000).
 *  In production everything is served from the same origin, so relative URLs work. */
function resolveAppUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const base =
    (import.meta.env as Record<string, string>).VITE_CHATBRIDGE_SERVER_URL ||
    (typeof window !== 'undefined' && window.location.protocol === 'https:' ? window.location.origin : 'http://localhost:3000')
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

type Props = {
  sessionId: string
}

type FrameStatus = 'loading' | 'ready' | 'error'

/** Per-app iframe child component. Each manages its own ref, status, and postMessage listener. */
function ChatBridgeAppFrame({
  sessionId,
  appName,
  isVisible,
}: {
  sessionId: string
  appName: string
  isVisible: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<FrameStatus>('loading')
  const [retryKey, setRetryKey] = useState(0)

  const registry = useStore(chatBridgeStore, (s) => s.registry)
  const token = useStore(authStore, (s) => s.token)

  const activeApp = registry.find((a) => a.name === appName) ?? null
  const resolvedBase = activeApp ? resolveAppUrl(activeApp.url) : null
  const appUrl = resolvedBase
    ? activeApp?.authRequired && token
      ? `${resolvedBase}?token=${encodeURIComponent(token)}`
      : resolvedBase
    : null

  // invokeToolAndWait: posts tool_invoke to iframe, returns a promise that resolves on tool_result
  const invokeToolAndWait = useCallback(
    (toolCallId: string, toolName: string, params: unknown): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chatBridgeStore.getState().removePendingToolCall(toolCallId)
          reject(new Error(`Tool call timed out: ${toolName} (${toolCallId})`))
        }, TOOL_TIMEOUT_MS)

        chatBridgeStore.getState().addPendingToolCall(toolCallId, { resolve, reject, timeout })

        iframeRef.current?.contentWindow?.postMessage(
          { type: 'tool_invoke', toolCallId, toolName, params },
          resolvedBase ? new URL(resolvedBase).origin : '*'
        )
      })
    },
    [resolvedBase]
  )

  // Register this iframe's invoker when it becomes the active (visible) app
  useEffect(() => {
    if (isVisible) {
      chatBridgeStore.getState().setToolInvoker(sessionId, invokeToolAndWait)
    }
    return () => {
      // Only clear if we are still the registered invoker
      if (isVisible) {
        const current = chatBridgeStore.getState().getToolInvoker(sessionId)
        if (current === invokeToolAndWait) {
          chatBridgeStore.getState().setToolInvoker(sessionId, null)
        }
      }
    }
  }, [sessionId, invokeToolAndWait, isVisible])

  // Set up postMessage listener and ready timeout
  useEffect(() => {
    if (!appName || !appUrl) return

    setStatus('loading')

    let readyResolved = false
    const onReady = () => {
      readyResolved = true
      clearTimeout(readyTimer)
      setStatus('ready')
    }

    const handleOAuthRequest = (provider: string) => {
      const currentToken = authStore.getState().token
      if (!currentToken) {
        console.warn('[ChatBridge] OAuth requested but user not authenticated')
        return
      }
      window.open(
        `${API_BASE}/api/oauth/${provider}/authorize?token=${encodeURIComponent(currentToken)}`,
        `${provider}-oauth`,
        'width=500,height=700,noopener=0'
      )
    }

    const handler = createMessageHandler(iframeRef, sessionId, appName, onReady, handleOAuthRequest)
    window.addEventListener('message', handler)

    const readyTimer = setTimeout(() => {
      if (!readyResolved) {
        console.warn(`[ChatBridge] ${appName} did not send ready within ${READY_TIMEOUT_MS}ms`)
        setStatus('error')
      }
    }, READY_TIMEOUT_MS)

    // Handle oauth_complete from popup windows — forward auth_ready to the iframe
    const handleOAuthComplete = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown>
      if (data?.type === 'oauth_complete' && typeof data.provider === 'string') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'auth_ready', provider: data.provider },
          resolvedBase ? new URL(resolvedBase).origin : '*'
        )
      }
    }
    window.addEventListener('message', handleOAuthComplete)

    return () => {
      window.removeEventListener('message', handler)
      window.removeEventListener('message', handleOAuthComplete)
      clearTimeout(readyTimer)
    }
  }, [sessionId, appName, appUrl, retryKey])

  if (!appUrl) return null

  return (
    <div className="flex-1 flex flex-col" style={{ display: isVisible ? 'flex' : 'none' }}>
      {/* Per-app header status */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200">
        <span>{appName}</span>
        {isVisible && status === 'loading' && (
          <span className="text-xs text-gray-400 animate-pulse">Loading…</span>
        )}
        {isVisible && status === 'error' && (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs text-blue-500 hover:underline"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
            <button
              type="button"
              className="text-xs text-gray-400 hover:underline"
              onClick={() => chatBridgeStore.getState().deactivateApp(sessionId, appName)}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 relative">
        {isVisible && status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 p-4">
            <span>⚠ App failed to load</span>
            <button
              type="button"
              className="px-3 py-1 rounded bg-blue-500 text-white text-xs hover:bg-blue-600"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <iframe
          key={`${resolvedBase}-${retryKey}`}
          ref={iframeRef}
          src={appUrl}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          title={appName}
          className="w-full h-full border-none"
          style={{ opacity: status === 'loading' && isVisible ? 0.4 : 1, transition: 'opacity 0.2s' }}
        />
      </div>
    </div>
  )
}

/** Container that renders one iframe per app in the session, showing only the active one. */
export function ChatBridgeFrame({ sessionId }: Props) {
  const sessionApps = useStore(chatBridgeStore, (s) => s.sessions[sessionId]?.apps ?? {})
  const activeApp = useStore(chatBridgeStore, (s) => s.sessions[sessionId]?.activeApp ?? null)

  const appNames = Object.keys(sessionApps)
  if (appNames.length === 0) return null

  return (
    <div className="flex flex-col w-[420px] min-w-[320px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* App tabs — show when multiple apps have been used */}
      {appNames.length > 1 && (
        <div className="flex gap-1 px-2 pt-1 border-b border-gray-200 dark:border-gray-700">
          {appNames.map((name) => (
            <button
              key={name}
              type="button"
              className={`px-2 py-1 text-xs rounded-t ${
                name === activeApp
                  ? 'bg-white dark:bg-gray-900 text-blue-600 border border-b-0 border-gray-200 dark:border-gray-700'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              onClick={() => {
                const registry = chatBridgeStore.getState().registry
                const app = registry.find((a) => a.name === name)
                if (app) void chatBridgeController.activate(sessionId, app)
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Render an iframe for each app — only the active one is visible */}
      {appNames.map((name) => (
        <ChatBridgeAppFrame
          key={name}
          sessionId={sessionId}
          appName={name}
          isVisible={name === activeApp}
        />
      ))}
    </div>
  )
}
