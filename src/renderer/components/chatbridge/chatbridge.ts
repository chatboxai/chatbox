import {
  getChatBridgeChessStatusText,
  isChatBridgeChessAppId,
  normalizeChatBridgeChessRuntimeSnapshot,
  readChatBridgeDegradedCompletion,
  type ChatBridgeRecoveryAction as DegradedRecoveryAction,
  type ChatBridgeRecoveryActionId,
  type ChatBridgeRecoveryItem as DegradedRecoveryItem,
} from '@shared/chatbridge'
import {
  ChessAppSnapshotSchema,
  getChessFallbackText,
  getChessStatusLabel,
  getChessSurfaceDescription,
  parseChessAppSnapshot,
} from '@shared/chatbridge/apps/chess'
import type { MessageAppLifecycle, MessageAppPart } from '@shared/types'

export type ChatBridgeShellState = 'loading' | 'ready' | 'active' | 'complete' | 'degraded' | 'error'

export interface ChatBridgeShellAction {
  id?: ChatBridgeRecoveryActionId
  label: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}

export interface ChatBridgeShellSupportItem {
  label: string
  description?: string
  tone?: 'neutral' | 'safe' | 'warning' | 'blocked'
}

export interface ChatBridgeShellSupportPanel {
  eyebrow?: string
  title: string
  description?: string
  items?: ChatBridgeShellSupportItem[]
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
  supportPanel?: ChatBridgeShellSupportPanel
  recoveryActions?: ChatBridgeShellAction[]
}

function mapRecoveryActions(
  actions: DegradedRecoveryAction[],
  requestedActionId?: string
): ChatBridgeShellAction[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    variant: action.variant,
    disabled: action.id === requestedActionId,
  }))
}

function mapSupportItems(items: DegradedRecoveryItem[]): ChatBridgeShellSupportItem[] {
  return items.map((item) => ({
    label: item.label,
    description: item.description,
    tone: item.tone,
  }))
}

export function getChatBridgeStatusLabel(state: ChatBridgeShellState | MessageAppLifecycle): string {
  return {
    loading: 'Loading',
    launching: 'Loading',
    ready: 'Ready',
    active: 'Running',
    complete: 'Complete',
    degraded: 'Recovery',
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
    stale: 'degraded',
  }

  return lifecycleToShellState[lifecycle]
}

export function getArtifactShellState(options: {
  generating?: boolean
  preview: boolean
  hasRenderableHtml: boolean
  bridgeError?: boolean
}): ChatBridgeShellState {
  if (options.generating) {
    return 'loading'
  }
  if (!options.hasRenderableHtml || options.bridgeError) {
    return 'error'
  }
  return options.preview ? 'active' : 'ready'
}

export function getMessageAppPartViewModel(part: MessageAppPart): ChatBridgeShellViewModel {
  const degradedCompletion = readChatBridgeDegradedCompletion(part)
  const state = degradedCompletion ? 'degraded' : getChatBridgeShellStateFromLifecycle(part.lifecycle)
  const shellLabel = part.appName || part.appId
  const appLabel = part.title || shellLabel

  if (isChatBridgeChessAppId(part.appId)) {
    const persistentSnapshot = ChessAppSnapshotSchema.safeParse(part.snapshot)
    if (persistentSnapshot.success) {
      const snapshot = parseChessAppSnapshot(part.snapshot)

      if (degradedCompletion) {
        return {
          state,
          title: part.title || 'Chess board',
          description:
            part.description || 'The chess runtime ended imperfectly, but the host kept the board state and recovery path inside the thread.',
          surfaceTitle: degradedCompletion.acknowledgement?.title ?? degradedCompletion.title,
          surfaceDescription: degradedCompletion.acknowledgement?.description ?? degradedCompletion.description,
          statusLabel: part.statusText || degradedCompletion.statusLabel,
          fallbackTitle: part.fallbackTitle || 'Chess fallback',
          fallbackText: part.fallbackText || getChessFallbackText(snapshot),
          supportPanel: degradedCompletion.supportPanel
            ? {
                eyebrow: degradedCompletion.supportPanel.eyebrow,
                title: degradedCompletion.supportPanel.title,
                description: degradedCompletion.supportPanel.description,
                items: mapSupportItems(degradedCompletion.supportPanel.items),
              }
            : undefined,
          recoveryActions: mapRecoveryActions(
            degradedCompletion.actions,
            degradedCompletion.acknowledgement?.requestedActionId
          ),
        }
      }

      return {
        state,
        title: part.title || 'Chess board',
        description: part.description || 'A live chess board is running inside the host shell for in-thread play.',
        surfaceTitle: 'Board surface',
        surfaceDescription: getChessSurfaceDescription(snapshot),
        statusLabel: part.statusText || getChessStatusLabel(snapshot),
        fallbackTitle: part.fallbackTitle || 'Chess fallback',
        fallbackText: part.fallbackText || getChessFallbackText(snapshot),
      }
    }

    const snapshot = normalizeChatBridgeChessRuntimeSnapshot(part.snapshot)

    if (degradedCompletion) {
      return {
        state,
        title: part.title || 'Chess board',
        description:
          part.description || 'The chess runtime degraded, but the host kept the validated board summary and recovery path inline.',
        surfaceTitle: degradedCompletion.acknowledgement?.title ?? degradedCompletion.title,
        surfaceDescription: degradedCompletion.acknowledgement?.description ?? degradedCompletion.description,
        statusLabel: part.statusText || degradedCompletion.statusLabel,
        fallbackTitle: part.fallbackTitle || 'Chess fallback',
        fallbackText:
          part.fallbackText ||
          part.error ||
          snapshot.feedback?.message ||
          'The host can still explain the latest chess board state if the live runtime stops responding.',
        supportPanel: degradedCompletion.supportPanel
          ? {
              eyebrow: degradedCompletion.supportPanel.eyebrow,
              title: degradedCompletion.supportPanel.title,
              description: degradedCompletion.supportPanel.description,
              items: mapSupportItems(degradedCompletion.supportPanel.items),
            }
          : undefined,
        recoveryActions: mapRecoveryActions(
          degradedCompletion.actions,
          degradedCompletion.acknowledgement?.requestedActionId
        ),
      }
    }

    return {
      state,
      title: part.title || 'Chess board',
      description: part.description || 'A live chess board is running inside the host shell for in-thread play.',
      surfaceTitle: 'Board surface',
      surfaceDescription: snapshot.boardContext.summary || 'The host owns the latest validated chess board state.',
      statusLabel: part.statusText || getChatBridgeChessStatusText(snapshot),
      fallbackTitle: part.fallbackTitle || 'Chess fallback',
      fallbackText:
        part.fallbackText ||
        part.error ||
        snapshot.feedback?.message ||
        'The host can still explain the latest chess board state if the live runtime stops responding.',
    }
  }

  const descriptions: Record<ChatBridgeShellState, string> = {
    loading: `${appLabel} is still being prepared inside the host-owned shell.`,
    ready: `${appLabel} is ready to open from the conversation without dropping into a raw preview panel.`,
    active: `${appLabel} is active inside the host-owned shell and remains part of the thread.`,
    complete: `${appLabel} finished and can be reopened from the same conversation surface.`,
    degraded: `${appLabel} ended in a degraded state, but the host kept the recovery path inside the thread.`,
    error: `${appLabel} could not stay active, so the host shell is presenting the fallback path inline.`,
  }

  const surfaceTitles: Record<ChatBridgeShellState, string> = {
    loading: `${shellLabel} shell`,
    ready: `${shellLabel} shell`,
    active: `${shellLabel} shell`,
    complete: `${shellLabel} shell`,
    degraded: `${shellLabel} recovery`,
    error: `${shellLabel} shell`,
  }

  const surfaceDescriptions: Record<ChatBridgeShellState, string> = {
    loading: 'The host keeps the shell visible while the app is still launching.',
    ready: 'The app can open from this shell when the user is ready.',
    active: 'The host continues to own lifecycle and recovery while the app is visible.',
    complete: 'The host keeps the end state inline without leaving a separate summary artifact behind.',
    degraded: 'The host explains what remains trusted, what is blocked, and which safe next step is available.',
    error: 'The host keeps the failure and recovery surface in the thread instead of dropping context.',
  }

  if (degradedCompletion) {
    return {
      state,
      title: appLabel,
      description: part.description || descriptions[state],
      surfaceTitle: degradedCompletion.acknowledgement?.title ?? degradedCompletion.title,
      surfaceDescription: degradedCompletion.acknowledgement?.description ?? degradedCompletion.description,
      statusLabel: part.statusText || degradedCompletion.statusLabel,
      fallbackTitle: part.fallbackTitle || 'Fallback',
      fallbackText: part.fallbackText || part.error || `${appLabel} can fall back to the host shell when the runtime cannot continue.`,
      supportPanel: degradedCompletion.supportPanel
        ? {
            eyebrow: degradedCompletion.supportPanel.eyebrow,
            title: degradedCompletion.supportPanel.title,
            description: degradedCompletion.supportPanel.description,
            items: mapSupportItems(degradedCompletion.supportPanel.items),
          }
        : undefined,
      recoveryActions: mapRecoveryActions(
        degradedCompletion.actions,
        degradedCompletion.acknowledgement?.requestedActionId
      ),
    }
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
