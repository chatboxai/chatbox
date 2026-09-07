import { createStore, useStore } from 'zustand'
import { delay } from '@/utils'
import * as scrollActions from './scrollActions'

// Ephemeral UI state linking the pending-action bar above the input box with the
// paused tool-call steps in the message list: which step should play the rotating
// locate ring after the bar's "View" action, and an attention pulse the bar plays
// when the user clicks the locked input while a decision is pending.
//
// A step can be mounted more than once (message list + search dialog), so the
// element registry is keyed per component instance under its exact message.

type PausedStepIdentity = {
  sessionId: string
  messageId: string
  toolCallId: string
}

type ApprovalAttentionState = {
  /** Step that should play the temporary locate ring (after "View" finds it). */
  highlightedPausedStep: PausedStepIdentity | null
  /** Monotonic token; each increment re-triggers the bar's attention pulse. */
  barPulseToken: number
}

export const approvalAttentionStore = createStore<ApprovalAttentionState>(() => ({
  highlightedPausedStep: null,
  barPulseToken: 0,
}))

/** Long enough for the rotating locate ring to complete about two laps. */
const HIGHLIGHT_DURATION_MS = 5000
let highlightTimer: ReturnType<typeof setTimeout> | null = null

function isSamePausedStep(left: PausedStepIdentity | null, right: PausedStepIdentity | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.toolCallId === right.toolCallId
  )
}

export function flashApprovalCardHighlight(sessionId: string, messageId: string, toolCallId: string) {
  if (highlightTimer) clearTimeout(highlightTimer)
  const target = { sessionId, messageId, toolCallId }
  approvalAttentionStore.setState({ highlightedPausedStep: target })
  highlightTimer = setTimeout(() => {
    highlightTimer = null
    approvalAttentionStore.setState((state) =>
      isSamePausedStep(state.highlightedPausedStep, target) ? { highlightedPausedStep: null } : state
    )
  }, HIGHLIGHT_DURATION_MS)
}

export function useApprovalCardHighlighted(
  sessionId: string | undefined,
  messageId: string | undefined,
  toolCallId: string
): boolean {
  return useStore(
    approvalAttentionStore,
    (state) =>
      sessionId !== undefined &&
      messageId !== undefined &&
      isSamePausedStep(state.highlightedPausedStep, { sessionId, messageId, toolCallId })
  )
}

/** Ask the pending-action bar to play its attention pulse (locked-input click). */
export function pulsePendingActionBar() {
  approvalAttentionStore.setState((state) => ({ barPulseToken: state.barPulseToken + 1 }))
}

export function usePendingActionBarPulseToken(): number {
  return useStore(approvalAttentionStore, (state) => state.barPulseToken)
}

// Registry of mounted paused-step elements. The bar's "View" action scrolls to a
// registered element instead of querying the DOM, so runtime behavior never
// depends on automation test ids.
const pausedStepElements = new Map<string, Map<string, HTMLElement>>()

function pausedStepKey(sessionId: string, messageId: string, toolCallId: string): string {
  return JSON.stringify([sessionId, messageId, toolCallId])
}

export function registerPausedStepElement(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  instanceId: string,
  element: HTMLElement
) {
  const key = pausedStepKey(sessionId, messageId, toolCallId)
  let instances = pausedStepElements.get(key)
  if (!instances) {
    instances = new Map()
    pausedStepElements.set(key, instances)
  }
  instances.set(instanceId, element)
}

export function unregisterPausedStepElement(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  instanceId: string
) {
  const key = pausedStepKey(sessionId, messageId, toolCallId)
  const instances = pausedStepElements.get(key)
  if (!instances) return
  instances.delete(instanceId)
  if (instances.size === 0) pausedStepElements.delete(key)
}

function getPausedStepElement(sessionId: string, messageId: string, toolCallId: string): HTMLElement | undefined {
  const instances = pausedStepElements.get(pausedStepKey(sessionId, messageId, toolCallId))
  if (!instances) return undefined
  return instances.values().next().value
}

const REVEAL_LOOKUP_ATTEMPTS = 12
const REVEAL_LOOKUP_INTERVAL_MS = 50
/** Mantine Collapse animates for 200ms by default; wait a little longer than that. */
const REVEAL_EXPAND_SETTLE_MS = 250

/**
 * Scroll the message list to the paused step and flash the locate ring. The step
 * may be unmounted (virtualized list), so first jump to the message, then wait for
 * the element to register before centering on it. Highlighting comes first: the
 * step reacts to it by expanding its collapsed details, and the scroll waits for
 * that expansion so the step lands centered at its final height.
 */
export async function revealPausedStep(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
  flashApprovalCardHighlight(sessionId, messageId, toolCallId)
  let target = getPausedStepElement(sessionId, messageId, toolCallId)
  if (!target) {
    await scrollActions.scrollToMessage(sessionId, messageId, 'center', 'auto')
    for (let attempt = 0; attempt < REVEAL_LOOKUP_ATTEMPTS && !target; attempt++) {
      await delay(REVEAL_LOOKUP_INTERVAL_MS)
      target = getPausedStepElement(sessionId, messageId, toolCallId)
    }
  }
  if (!target) return
  // Wait for the highlight-driven expansion so the scroll centers the final height.
  await delay(REVEAL_EXPAND_SETTLE_MS)
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
