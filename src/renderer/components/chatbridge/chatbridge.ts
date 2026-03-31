import type { MessageAppLifecycle, MessageAppPart } from '@shared/types'

export type ChatBridgeShellState = 'loading' | 'ready' | 'active' | 'complete' | 'error'

export interface ChatBridgeShellAction {
  label: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
}

export interface ChatBridgeShellViewModel {
  state: ChatBridgeShellState
  title: string
  description: string
  surfaceTitle: string
  surfaceDescription: string
  statusLabel: string
  fallbackTitle?: string
  fallbackText?: string
}

export function getChatBridgeStatusLabel(state: ChatBridgeShellState | MessageAppLifecycle): string {
  return {
    loading: 'Loading',
    launching: 'Loading',
    ready: 'Ready',
    active: 'Running',
    complete: 'Complete',
    error: 'Fallback',
    stale: 'Stale',
  }[state]
}

export function getChatBridgeShellStateFromLifecycle(lifecycle: MessageAppLifecycle): ChatBridgeShellState {
  const lifecycleToShellState: Record<MessageAppLifecycle, ChatBridgeShellState> = {
    launching: 'loading',
    ready: 'ready',
    active: 'active',
    complete: 'complete',
    error: 'error',
    stale: 'error',
  }

  return lifecycleToShellState[lifecycle]
}

export function getArtifactShellState(options: {
  generating?: boolean
  preview: boolean
  hasRenderableHtml: boolean
}): ChatBridgeShellState {
  if (options.generating) {
    return 'loading'
  }
  if (!options.hasRenderableHtml) {
    return 'error'
  }
  return options.preview ? 'active' : 'ready'
}

export function getMessageAppPartViewModel(part: MessageAppPart): ChatBridgeShellViewModel {
  const state = getChatBridgeShellStateFromLifecycle(part.lifecycle)
  const shellLabel = part.appName || part.appId
  const appLabel = part.title || shellLabel

  const descriptions: Record<ChatBridgeShellState, string> = {
    loading: `${appLabel} is still being prepared inside the host-owned shell.`,
    ready: `${appLabel} is ready to open from the conversation without dropping into a raw preview panel.`,
    active: `${appLabel} is active inside the host-owned shell and remains part of the thread.`,
    complete: `${appLabel} finished and can be reopened from the same conversation surface.`,
    error: `${appLabel} could not stay active, so the host shell is presenting the fallback path inline.`,
  }

  const surfaceTitles: Record<ChatBridgeShellState, string> = {
    loading: `${shellLabel} shell`,
    ready: `${shellLabel} shell`,
    active: `${shellLabel} shell`,
    complete: `${shellLabel} shell`,
    error: `${shellLabel} shell`,
  }

  const surfaceDescriptions: Record<ChatBridgeShellState, string> = {
    loading: 'The host keeps the shell visible while the app is still launching.',
    ready: 'The app can open from this shell when the user is ready.',
    active: 'The host continues to own lifecycle and recovery while the app is visible.',
    complete: 'The host keeps the end state inline without leaving a separate summary artifact behind.',
    error: 'The host keeps the failure and recovery surface in the thread instead of dropping context.',
  }

  return {
    state,
    title: appLabel,
    description: part.description || descriptions[state],
    surfaceTitle: surfaceTitles[state],
    surfaceDescription: surfaceDescriptions[state],
    statusLabel: part.statusText || getChatBridgeStatusLabel(part.lifecycle),
    fallbackTitle: part.fallbackTitle || 'Fallback',
    fallbackText: part.fallbackText || part.error || `${appLabel} can fall back to the host shell when the runtime cannot continue.`,
  }
}
