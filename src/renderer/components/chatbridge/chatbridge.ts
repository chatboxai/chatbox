import { getChatBridgeRecoveryState, getChatBridgeRouteDecision } from '@shared/chatbridge'
import type { MessageAppLifecycle, MessageAppPart } from '@shared/types'

export type ChatBridgeShellState = 'loading' | 'ready' | 'active' | 'complete' | 'error'

export interface ChatBridgeShellAction {
  label: string
  onClick?: () => void
  variant?: 'primary' | 'secondary'
  prompt?: string
  disabled?: boolean
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
  goalLabel?: string
  goalText?: string
  recoveryLabel?: string
  recoveryText?: string
  recoveryFootnote?: string
  recoveryTone?: 'warning' | 'calm'
  primaryAction?: Omit<ChatBridgeShellAction, 'onClick'>
  secondaryAction?: Omit<ChatBridgeShellAction, 'onClick'>
}

function getRouteActionPrompt(options: {
  kind: 'invoke' | 'clarify' | 'refuse'
  prompt: string
  selectedAppName?: string
  alternateAppNames?: string[]
}): { primaryAction?: Omit<ChatBridgeShellAction, 'onClick'>; secondaryAction?: Omit<ChatBridgeShellAction, 'onClick'> } {
  const selectedAppName = options.selectedAppName?.trim()
  const alternateHint =
    options.alternateAppNames && options.alternateAppNames.length > 0
      ? ` Alternate reviewed apps considered: ${options.alternateAppNames.join(', ')}.`
      : ''

  if (options.kind === 'invoke' && selectedAppName) {
    return {
      primaryAction: {
        label: `Open ${selectedAppName}`,
        prompt: `Open ${selectedAppName} for this request: "${options.prompt}". Explain briefly why this reviewed app is the clearest fit before launching it.`,
      },
      secondaryAction: {
        label: 'Continue in chat',
        prompt: `Continue helping in chat without launching an app. User request: "${options.prompt}".${alternateHint}`,
      },
    }
  }

  if (options.kind === 'clarify' && selectedAppName) {
    return {
      primaryAction: {
        label: `Open ${selectedAppName}`,
        prompt: `Use ${selectedAppName} for this request: "${options.prompt}". Confirm the reviewed-app fit before opening it.${alternateHint}`,
      },
      secondaryAction: {
        label: 'Continue in chat',
        prompt: `Keep helping in chat without launching a reviewed app. User request: "${options.prompt}". If a reviewed app would help later, say which one and why.${alternateHint}`,
      },
    }
  }

  return {
    primaryAction: {
      label: 'Continue in chat',
      prompt: `Continue helping in chat without launching a reviewed app. User request: "${options.prompt}".`,
    },
    secondaryAction: {
      label: 'Explain why',
      prompt: `Explain why this request should stay in chat instead of launching a reviewed app: "${options.prompt}".`,
    },
  }
}

function getRouteDecisionViewModel(part: MessageAppPart): ChatBridgeShellViewModel | null {
  const decision = getChatBridgeRouteDecision(part)
  if (!decision) {
    return null
  }

  const selectedMatch =
    (decision.selectedAppId ? decision.matches.find((match) => match.appId === decision.selectedAppId) : null) ??
    decision.matches[0] ??
    null
  const alternateAppNames = decision.matches
    .filter((match) => match.appId !== selectedMatch?.appId)
    .map((match) => match.appName)
  const actionSet = getRouteActionPrompt({
    kind: decision.kind,
    prompt: decision.prompt,
    selectedAppName: selectedMatch?.appName,
    alternateAppNames,
  })

  if (decision.kind === 'invoke') {
    const appLabel = selectedMatch?.appName ?? part.appName ?? part.appId

    return {
      state: 'ready',
      title: `${appLabel} is the clearest fit`,
      description: `The host found an explicit reviewed-app match and can open ${appLabel} without guessing.`,
      surfaceTitle: 'Reviewed app route',
      surfaceDescription: decision.summary,
      statusLabel: part.statusText || 'Launch app',
      goalLabel: 'Your request',
      goalText: decision.prompt,
      ...actionSet,
    }
  }

  if (decision.kind === 'clarify') {
    const appLabel = selectedMatch?.appName ?? part.appName ?? part.appId
    const alternateLabel =
      alternateAppNames.length > 0
        ? ` Also plausible: ${alternateAppNames.join(', ')}.`
        : ''

    return {
      state: 'ready',
      title: 'Choose the next step',
      description: `The host is keeping the routing choice in-thread instead of guessing.${alternateLabel}`,
      surfaceTitle: 'Routing stays in the conversation',
      surfaceDescription: decision.summary,
      statusLabel: part.statusText || 'Clarify',
      goalLabel: 'Your request',
      goalText: decision.prompt,
      ...actionSet,
      ...(appLabel ? { fallbackTitle: appLabel } : {}),
    }
  }

  const closestMatchLabel = selectedMatch ? ` Closest reviewed app: ${selectedMatch.appName}.` : ''

  return {
    state: 'ready',
    title: 'Keep this in chat',
    description: 'No reviewed app is a confident enough fit to justify a launch from this turn.',
    surfaceTitle: 'No app launch suggested',
    surfaceDescription: `${decision.summary}${closestMatchLabel}`,
    statusLabel: part.statusText || 'Chat only',
    goalLabel: 'Your request',
    goalText: decision.prompt,
    ...actionSet,
  }
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
  const routeDecision = getRouteDecisionViewModel(part)
  if (routeDecision) {
    return routeDecision
  }

  const recovery = getChatBridgeRecoveryState(part)
  const state = recovery ? 'error' : getChatBridgeShellStateFromLifecycle(part.lifecycle)
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
    description:
      part.description ||
      (recovery
        ? `Instead of forcing an immediate relaunch, the host is keeping the last safe ${shellLabel} context inline so the conversation can continue.`
        : descriptions[state]),
    surfaceTitle: surfaceTitles[state],
    surfaceDescription:
      recovery?.summary ??
      part.fallbackText ??
      surfaceDescriptions[state],
    statusLabel: part.statusText || (recovery ? 'Needs recovery' : getChatBridgeStatusLabel(part.lifecycle)),
    fallbackTitle: part.fallbackTitle || 'Fallback',
    fallbackText: part.fallbackText || part.error || `${appLabel} can fall back to the host shell when the runtime cannot continue.`,
    goalLabel: recovery?.userGoal ? 'Last user goal' : undefined,
    goalText: recovery?.userGoal,
    recoveryLabel: recovery?.label,
    recoveryText: recovery?.summary,
    recoveryFootnote: recovery?.footnote,
    recoveryTone: recovery?.tone,
    ...(recovery?.actions?.[0] ? { primaryAction: recovery.actions[0] } : {}),
    ...(recovery?.actions?.[1] ? { secondaryAction: recovery.actions[1] } : {}),
  }
}
