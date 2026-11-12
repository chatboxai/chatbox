import type { SessionTranscriptOrigin } from '@chatbox/core/ports'
import {
  useSessionTranscript as useSharedSessionTranscript,
  type SessionTranscriptViewportAnchor,
} from '@chatbox/react/query'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'

export function useSessionPresentation(sessionId: string | null) {
  const query = rendererApplication.sessionHooks.useSessionHeader(sessionId)
  return { ...query, header: query.session }
}

export function useSessionTranscript(
  sessionId: string | null,
  initialOrigin: SessionTranscriptOrigin = 'tail',
  captureAnchor?: () => SessionTranscriptViewportAnchor | null
) {
  return useSharedSessionTranscript({
    sessionId: sessionId ?? '',
    platform: platform.type === 'mobile' ? 'capacitor' : platform.type === 'desktop' ? 'electron' : 'web',
    source: rendererApplication.sessions,
    bridge: rendererApplication.sessionQueryBridge,
    initialOrigin,
    captureAnchor,
  })
}
