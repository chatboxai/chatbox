import type { RefObject } from 'react'
import { BridgeMessageSchema } from '../../../shared/types/chatbridge'
import { chatBridgeStore } from '../../stores/chatBridgeStore'

const KNOWN_TYPES = ['ready', 'register_tools', 'tool_result', 'state_update', 'completion', 'oauth_request'] as const
type KnownType = (typeof KNOWN_TYPES)[number]

export function createMessageHandler(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  sessionId: string,
  appName: string,
  onReady: () => void,
  onOAuthRequest?: (provider: string) => void
) {
  return function handleMessage(event: MessageEvent) {
    // 1. Source validation — primary security check.
    // Sandboxed iframes (allow-scripts only) have opaque 'null' origin,
    // so event.source is the authoritative check.
    if (event.source !== iframeRef.current?.contentWindow) return

    // 2. Type field exists and is a known type
    const rawType = (event.data as Record<string, unknown>)?.type
    if (typeof rawType !== 'string' || !KNOWN_TYPES.includes(rawType as KnownType)) return

    // 3. Structural validation via Zod
    const parsed = BridgeMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      console.warn('[ChatBridge] Invalid message structure from', appName, parsed.error.issues)
      return
    }

    const msg = parsed.data
    console.log(`[ChatBridge] ${appName} →`, msg.type, msg)

    switch (msg.type) {
      case 'ready':
        console.log(`[ChatBridge] App ready: ${appName}`)
        onReady()
        break

      case 'register_tools':
        console.log(`[ChatBridge] ${appName} registered ${msg.schemas.length} tool(s)`)
        break

      case 'tool_result': {
        const store = chatBridgeStore.getState()
        const pending = store.pendingToolCalls[msg.toolCallId]
        if (pending) {
          clearTimeout(pending.timeout)
          pending.resolve(msg.result)
          store.removePendingToolCall(msg.toolCallId)
        } else {
          console.warn(`[ChatBridge] No pending tool call for id: ${msg.toolCallId}`)
        }
        break
      }

      case 'state_update':
        chatBridgeStore.getState().updateAppState(sessionId, appName, msg.state)
        break

      case 'completion':
        console.log(`[ChatBridge] ${appName} completed:`, msg.result)
        break

      case 'oauth_request':
        if (onOAuthRequest) {
          onOAuthRequest(msg.provider)
        } else {
          console.warn(`[ChatBridge] ${appName} requested OAuth for ${msg.provider} but no handler registered`)
        }
        break
    }
  }
}
