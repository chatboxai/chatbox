import { withSessionGenerationLock } from '@chatbox/core/generation'
import {
  countCancellableGeneratingAssistantMessages,
  getGenerationControlMessages,
} from '@chatbox/core/session/generation-state'
import { createMessage, type Message, type Session } from '@shared/types'
import { createStore } from 'zustand'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'

const log = getLogger('message-queue')

const RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_DELIVERY_ATTEMPTS = 10
export const MAX_QUEUED_MESSAGES = 20

export type QueuePausedReason = 'stopped' | 'error' | 'agent-mode-suggested' | 'conversation-changed'

export interface QueuedUserMessage {
  id: string
  message: Message
  createdAt: number
  /**
   * Id of the newest conversation message at enqueue time. Delivery is bound to
   * the originating conversation: if a thread switch replaced the conversation
   * before delivery, the anchor is gone and the queue pauses instead of sending
   * the message into the wrong context.
   */
  conversationAnchorId?: string
  /**
   * Delivery in progress. The item stays in the (persisted) queue so a crash
   * before the session write completes cannot lose the message; the flag keeps
   * steering and re-delivery from consuming it twice, and is cleared on hydrate
   * so a restart retries (idempotently) instead of dropping it.
   */
  inFlight?: boolean
  /**
   * The user explicitly asked this item to jump the queue ("send now" on the
   * item). Steering only ever consumes requested items — by default queued
   * messages wait for the running reply to finish and are delivered in order,
   * one per generation. Cleared on hydrate: the generation it targeted is gone.
   */
  steerRequested?: boolean
}

interface MessageQueueState {
  queues: Record<string, QueuedUserMessage[] | undefined>
  paused: Record<string, QueuePausedReason | undefined>
}

// Queued messages hold user text (and attachment references) that exists nowhere
// else once the input draft is cleared, so the queue must survive a reload/crash.
const PERSIST_KEY = 'chatbox-message-queue-state'

function loadPersistedState(): MessageQueueState {
  try {
    if (typeof localStorage === 'undefined') return { queues: {}, paused: {} }
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { queues: {}, paused: {} }
    const parsed = JSON.parse(raw) as MessageQueueState
    // Clear stale in-flight flags (a crash mid-delivery must retry the item)
    // and steer requests (the generation they targeted no longer exists).
    const queues: MessageQueueState['queues'] = {}
    for (const [sessionId, queue] of Object.entries(parsed.queues ?? {})) {
      queues[sessionId] = queue?.map((item) =>
        item.inFlight || item.steerRequested ? { ...item, inFlight: undefined, steerRequested: undefined } : item
      )
    }
    return { queues, paused: parsed.paused ?? {} }
  } catch (error) {
    log.error('Failed to restore persisted message queue state:', error)
    return { queues: {}, paused: {} }
  }
}

// Tracks whether the most recent write-through landed. Enqueue consults this to
// refuse a non-durable enqueue: reporting success would let InputBox clear the
// draft, and a reload would then lose the message entirely.
let lastPersistFailed = false

function persistState(state: MessageQueueState): void {
  try {
    if (typeof localStorage === 'undefined') {
      lastPersistFailed = false
      return
    }
    if (Object.keys(state.queues).length === 0 && Object.keys(state.paused).length === 0) {
      localStorage.removeItem(PERSIST_KEY)
    } else {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(state))
    }
    lastPersistFailed = false
  } catch (error) {
    lastPersistFailed = true
    log.error('Failed to persist message queue state:', error)
  }
}

export const messageQueueStore = createStore<MessageQueueState>(() => loadPersistedState())

messageQueueStore.subscribe((state) => persistState(state))

// Non-reactive drain machinery. Delivery attempt/deferral counters live here
// instead of on the store items so retries don't trigger UI re-renders.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const draining = new Set<string>()
// A generation may settle while a drain is still unwinding from its deferred
// gate. Remember that wake so the drain's finally schedules an immediate retry
// instead of restoring the stale backoff delay.
const wakeAfterDrain = new Set<string>()
const attemptCounters = new Map<string, number>()
const deferralCounters = new Map<string, number>()
// "Send now" must be able to flush a queue whose last assistant message ended in
// canceled/error state; the flag is consumed by the first gate check that would
// otherwise pause the queue again.
const forceResume = new Set<string>()

function getQueue(sessionId: string): QueuedUserMessage[] {
  return messageQueueStore.getState().queues[sessionId] ?? []
}

function setQueue(sessionId: string, queue: QueuedUserMessage[]): void {
  messageQueueStore.setState((state) => {
    const queues = { ...state.queues }
    if (queue.length === 0) {
      delete queues[sessionId]
    } else {
      queues[sessionId] = queue
    }
    return { queues }
  })
}

export function getQueuePausedReason(sessionId: string): QueuePausedReason | undefined {
  return messageQueueStore.getState().paused[sessionId]
}

function setPaused(sessionId: string, reason: QueuePausedReason | undefined): void {
  messageQueueStore.setState((state) => {
    const paused = { ...state.paused }
    if (reason === undefined) {
      delete paused[sessionId]
    } else {
      paused[sessionId] = reason
    }
    return { paused }
  })
}

function retryDelay(attempts: number): number {
  return Math.min(RETRY_DELAY_MS * 2 ** Math.min(attempts, 5), MAX_RETRY_DELAY_MS)
}

function scheduleDrain(sessionId: string, delay = 0): void {
  if (!getQueue(sessionId).length || timers.has(sessionId) || draining.has(sessionId)) return
  if (getQueuePausedReason(sessionId)) return
  const timer = setTimeout(() => {
    timers.delete(sessionId)
    void drainQueue(sessionId)
  }, delay)
  timers.set(sessionId, timer)
}

export function isSteerableQueuedMessage(message: Message): boolean {
  if (message.files?.length || message.links?.length) return false
  return message.contentParts.every((part) => part.type === 'text')
}

function findLastAssistantMessage(session: Session): Message | undefined {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    if (session.messages[i].role === 'assistant') return session.messages[i]
  }
  return undefined
}

function currentConversationHasPausedToolCall(session: Session): boolean {
  return session.messages.some((message) =>
    message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')
  )
}

function consumeForceResume(sessionId: string): boolean {
  if (!forceResume.has(sessionId)) return false
  forceResume.delete(sessionId)
  return true
}

function setItemInFlight(sessionId: string, itemId: string, inFlight: boolean): void {
  setQueue(
    sessionId,
    getQueue(sessionId).map((item) => (item.id === itemId ? { ...item, inFlight: inFlight ? true : undefined } : item))
  )
}

type DeliveryOutcome = 'delivered' | 'deferred' | 'discard' | 'stale' | { paused: QueuePausedReason }

function deliverQueuedMessage(sessionId: string, item: QueuedUserMessage): Promise<DeliveryOutcome> {
  return withSessionGenerationLock(sessionId, async (): Promise<DeliveryOutcome> => {
    // Steering may have consumed this item while we waited for the lock.
    if (getQueue(sessionId)[0]?.id !== item.id) return 'stale'

    const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
    if (!session) return 'discard'

    const activePathHasItem = session.messages.some((message) => message.id === item.id)

    // The conversation the item was queued for is no longer the active path
    // (thread or fork switched); pause instead of sending it into the wrong
    // context. Saved fork branches may still contain the anchor or a partially
    // persisted copy of the queued message, so both checks must use only the
    // active linear path (session.messages).
    if (
      !activePathHasItem &&
      item.conversationAnchorId &&
      !session.messages.some((message) => message.id === item.conversationAnchorId)
    ) {
      return { paused: 'conversation-changed' }
    }

    // Alternative replies generate concurrently without holding the session lock,
    // so an explicit check is required in addition to lock serialization.
    const activeGenerationMessageIds = rendererApplication.generationRuntime.getActiveMessageIds(sessionId)
    if (
      countCancellableGeneratingAssistantMessages(
        getGenerationControlMessages(session, activeGenerationMessageIds),
        activeGenerationMessageIds
      ) > 0
    )
      return 'deferred'
    // A paused tool call is waiting for user approval; delivering now would start
    // a follow-up generation behind the approval dialog.
    if (currentConversationHasPausedToolCall(session)) return 'deferred'

    // A previous attempt may have persisted the user message and then failed;
    // re-submitting would append a duplicate. If the reply never started (the
    // user message is last) or only its placeholder exists (a stale generating
    // assistant right after it), resume the generation instead.
    if (activePathHasItem) {
      const lastMessage = session.messages.at(-1)
      const orphanUserMessage = lastMessage?.id === item.id ? lastMessage : undefined
      const orphanPlaceholder =
        !orphanUserMessage &&
        lastMessage?.role === 'assistant' &&
        lastMessage.generating === true &&
        !activeGenerationMessageIds.has(lastMessage.id) &&
        session.messages.at(-2)?.id === item.id
          ? lastMessage
          : undefined
      const persistedMessage = orphanUserMessage ?? (orphanPlaceholder ? session.messages.at(-2) : undefined)
      if (persistedMessage) {
        setItemInFlight(sessionId, item.id, true)
        try {
          const [{ insertMessage, modifyMessage, attachLargeFileRagMetadata }, { _generateWithoutSessionLock }] =
            await Promise.all([import('./messages'), import('./generation')])
          // The failed attempt may have stopped before attachment metadata was
          // prepared; re-run it (idempotent) so retrieval files keep their ids.
          const preparedMessage = await attachLargeFileRagMetadata(sessionId, persistedMessage)
          if (preparedMessage !== persistedMessage) {
            await modifyMessage(sessionId, preparedMessage, true)
          }
          let assistantMessage: Message
          if (orphanPlaceholder) {
            assistantMessage = { ...orphanPlaceholder, generating: true }
          } else {
            assistantMessage = { ...createMessage('assistant', ''), generating: true }
            await insertMessage(sessionId, assistantMessage)
          }
          await _generateWithoutSessionLock(sessionId, assistantMessage, { operationType: 'send_message' })
        } catch (error) {
          setItemInFlight(sessionId, item.id, false)
          throw error
        }
      }
      removeQueuedMessage(sessionId, item.id)
      return 'delivered'
    }

    const lastAssistant = findLastAssistantMessage(session)
    if (lastAssistant && !consumeForceResume(sessionId)) {
      if (lastAssistant.finishReason === 'canceled') return { paused: 'stopped' }
      if (lastAssistant.error !== undefined || lastAssistant.errorCode !== undefined) return { paused: 'error' }
      if (lastAssistant.finishReason === 'agent-mode-suggested') return { paused: 'agent-mode-suggested' }
    }

    // Mark the item in-flight (rather than removing it) before the generation
    // starts: the flag keeps the new generation's steering consumer from
    // injecting it a second time, while the durable copy survives a crash
    // during the blocking pre-insert work (e.g. compaction).
    setItemInFlight(sessionId, item.id, true)
    try {
      // Lazy import to avoid a circular dependency (messages.ts -> generation.ts -> orchestration.ts -> this file).
      const { submitNewUserMessageUnlocked } = await import('./messages')
      await submitNewUserMessageUnlocked(sessionId, { newUserMsg: item.message, needGenerating: true })
    } catch (error) {
      setItemInFlight(sessionId, item.id, false)
      throw error
    }
    removeQueuedMessage(sessionId, item.id)
    return 'delivered'
  })
}

async function drainQueue(sessionId: string): Promise<void> {
  if (draining.has(sessionId)) return
  draining.add(sessionId)
  let delay: number | undefined
  try {
    while (getQueue(sessionId).length > 0 && !getQueuePausedReason(sessionId)) {
      const next = getQueue(sessionId)[0]
      try {
        // 'delivered' implies deliverQueuedMessage already removed the item from the queue.
        const outcome = await deliverQueuedMessage(sessionId, next)
        if (outcome === 'delivered' || outcome === 'stale') {
          attemptCounters.delete(sessionId)
          deferralCounters.delete(sessionId)
          continue
        }
        if (outcome === 'discard') {
          clearQueue(sessionId)
          break
        }
        if (outcome === 'deferred') {
          const deferrals = (deferralCounters.get(sessionId) ?? 0) + 1
          deferralCounters.set(sessionId, deferrals)
          delay = retryDelay(deferrals - 1)
          break
        }
        pauseQueue(sessionId, outcome.paused)
        break
      } catch (error) {
        const attempts = (attemptCounters.get(sessionId) ?? 0) + 1
        attemptCounters.set(sessionId, attempts)
        log.error('Failed to deliver queued user message:', error)
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          // Never drop a user message: park the queue instead so the user can
          // retry via "Send now" or remove the item.
          pauseQueue(sessionId, 'error')
        } else {
          delay = retryDelay(attempts)
        }
        break
      }
    }
  } finally {
    draining.delete(sessionId)
    const shouldWakeImmediately = wakeAfterDrain.delete(sessionId)
    if (getQueue(sessionId).length === 0) {
      attemptCounters.delete(sessionId)
      deferralCounters.delete(sessionId)
      forceResume.delete(sessionId)
    } else {
      scheduleDrain(sessionId, shouldWakeImmediately ? 0 : (delay ?? 0))
    }
  }
}

export type EnqueueResult = 'queued' | 'full' | 'persist-failed'

/** Anything but 'queued' means the message was NOT enqueued and the caller must keep the draft. */
export function enqueueUserMessage(sessionId: string, message: Message, conversationAnchorId?: string): EnqueueResult {
  const queue = getQueue(sessionId)
  if (queue.length >= MAX_QUEUED_MESSAGES) return 'full'
  setQueue(sessionId, [...queue, { id: message.id, message, createdAt: Date.now(), conversationAnchorId }])
  // The write-through runs synchronously in the store subscription. If it failed,
  // the enqueue is not durable: undo it so the caller keeps the persisted draft
  // instead of clearing the only surviving copy of the user's text.
  if (lastPersistFailed) {
    setQueue(
      sessionId,
      getQueue(sessionId).filter((item) => item.id !== message.id)
    )
    return 'persist-failed'
  }
  if (!conversationAnchorId) {
    stampConversationAnchor(sessionId, message.id)
  }
  scheduleDrain(sessionId)
  return 'queued'
}

// Best-effort async stamp; an unstamped item simply skips the conversation-changed gate.
function stampConversationAnchor(sessionId: string, itemId: string): void {
  void rendererApplication.sessionQueryBridge
    .getSession(sessionId)
    .then((session) => {
      if (!session) return
      const anchorId = session.messages.at(-1)?.id
      if (!anchorId) return
      setQueue(
        sessionId,
        getQueue(sessionId).map((item) =>
          item.id === itemId && !item.conversationAnchorId ? { ...item, conversationAnchorId: anchorId } : item
        )
      )
    })
    .catch(() => {})
}

export function removeQueuedMessage(sessionId: string, messageId: string): void {
  const remaining = getQueue(sessionId).filter((item) => item.id !== messageId)
  if (remaining.length === 0) {
    // Removing the final item empties the queue; a lingering (persisted) paused
    // reason would otherwise be inherited by the next enqueued message.
    clearQueue(sessionId)
    return
  }
  setQueue(sessionId, remaining)
}

export function clearQueue(sessionId: string): void {
  setQueue(sessionId, [])
  setPaused(sessionId, undefined)
  forceResume.delete(sessionId)
  wakeAfterDrain.delete(sessionId)
  attemptCounters.delete(sessionId)
  deferralCounters.delete(sessionId)
  const timer = timers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(sessionId)
  }
}

/**
 * Clear only messages that have not started delivery/steering. In-flight items
 * stay persisted until their session write succeeds, preserving the crash-safe
 * handoff promised by the queue lifecycle.
 */
export function clearPendingQueuedMessages(sessionId: string): void {
  const inFlightItems = getQueue(sessionId).filter((item) => item.inFlight)
  if (inFlightItems.length === 0) {
    clearQueue(sessionId)
    return
  }
  setQueue(sessionId, inFlightItems)
}

export function pauseQueue(sessionId: string, reason: QueuePausedReason): void {
  setPaused(sessionId, reason)
}

export function resumeQueueAndDrain(sessionId: string): void {
  setPaused(sessionId, undefined)
  attemptCounters.delete(sessionId)
  deferralCounters.delete(sessionId)
  forceResume.add(sessionId)
  wakeQueuedUserMessages(sessionId)
}

/**
 * Ask a queued item to jump the queue: the running generation's steering
 * consumer will inject it at its next step. Only plain-text items can jump
 * (attachments cannot be injected mid-stream). Returns false when the request
 * is not possible right now.
 */
export function requestSteerQueuedMessage(sessionId: string, itemId: string): boolean {
  if (getQueuePausedReason(sessionId)) return false
  const item = getQueue(sessionId).find((queued) => queued.id === itemId)
  if (!item || item.inFlight || !isSteerableQueuedMessage(item.message)) return false
  setQueue(
    sessionId,
    getQueue(sessionId).map((queued) => (queued.id === itemId ? { ...queued, steerRequested: true } : queued))
  )
  return true
}

/** Replace the text of a queued item (edit-in-place; the item keeps its position). */
export function updateQueuedMessageText(sessionId: string, itemId: string, text: string): void {
  setQueue(
    sessionId,
    getQueue(sessionId).map((queued) => {
      if (queued.id !== itemId || queued.inFlight) return queued
      const hasTextPart = queued.message.contentParts.some((part) => part.type === 'text')
      if (hasTextPart && queued.message.contentParts.every((part) => part.type !== 'text' || part.text === text)) {
        return queued
      }
      const contentParts = hasTextPart
        ? queued.message.contentParts.map((part) => (part.type === 'text' ? { ...part, text } : part))
        : [{ type: 'text' as const, text }, ...queued.message.contentParts]
      // Token counts describe the previous text; both the send-path estimate
      // and the analyzer's legacy-cache check would keep trusting them for
      // the edited one, so delivery and steering must re-estimate.
      return {
        ...queued,
        message: {
          ...queued.message,
          contentParts,
          tokenCount: undefined,
          tokenCountMap: undefined,
          tokenCalculatedAt: undefined,
          tokenCountApproximate: undefined,
        },
      }
    })
  )
}

/**
 * Claim the first user-requested steerable item for steering injection.
 *
 * Queued messages do NOT steer by default — they wait for the running reply and
 * are delivered in order, one per generation. Only items the user explicitly
 * asked to jump the queue (`requestSteerQueuedMessage`) are consumed here.
 *
 * The item is NOT removed: it is marked in-flight so the durable copy survives
 * a crash while the caller persists it into the session. The caller must call
 * `removeQueuedMessage` once persistence succeeds, or
 * `releaseInFlightQueuedMessage` on failure.
 *
 * Consumption is bound to the consuming generation's conversation: an inactive
 * fork's generation must not steer a message the user queued for another fork.
 * An unstamped or foreign anchor leaves the item for the delivery path, which
 * re-checks against the active conversation.
 */
export function takeRequestedSteerableMessage(
  sessionId: string,
  isFromConversation: (anchorMessageId: string) => boolean
): QueuedUserMessage | undefined {
  if (getQueuePausedReason(sessionId)) return undefined
  const item = getQueue(sessionId).find(
    (queued) => queued.steerRequested && !queued.inFlight && isSteerableQueuedMessage(queued.message)
  )
  if (!item) return undefined
  if (!item.conversationAnchorId || !isFromConversation(item.conversationAnchorId)) return undefined
  setItemInFlight(sessionId, item.id, true)
  return item
}

/**
 * Drop steer requests that were never consumed. Called when the generation they
 * targeted terminates: the items simply deliver in order afterwards, and the
 * "interjecting" state must not linger in the UI.
 */
export function clearPendingSteerRequests(sessionId: string): void {
  const queue = getQueue(sessionId)
  if (!queue.some((item) => item.steerRequested && !item.inFlight)) return
  setQueue(
    sessionId,
    queue.map((item) => (item.steerRequested && !item.inFlight ? { ...item, steerRequested: undefined } : item))
  )
}

/** Undo an in-flight claim (delivery or steering persistence failed). */
export function releaseInFlightQueuedMessage(sessionId: string, itemId: string): void {
  setQueue(
    sessionId,
    getQueue(sessionId).map((item) =>
      // Also drop the steer request so a persistent failure cannot loop on
      // every step; the user can ask again.
      item.id === itemId ? { ...item, inFlight: undefined, steerRequested: undefined } : item
    )
  )
}

/** Kick the queue right after a generation settles instead of waiting out a retry timer. */
export function wakeQueuedUserMessages(sessionId: string): void {
  if (!getQueue(sessionId).length) return
  if (draining.has(sessionId)) {
    wakeAfterDrain.add(sessionId)
    return
  }
  const timer = timers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(sessionId)
  }
  scheduleDrain(sessionId)
}

export function resetMessageQueueForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  draining.clear()
  wakeAfterDrain.clear()
  attemptCounters.clear()
  deferralCounters.clear()
  forceResume.clear()
  messageQueueStore.setState({ queues: {}, paused: {} })
}

export async function flushMessageQueueForTests(): Promise<void> {
  for (const [sessionId, timer] of timers) {
    clearTimeout(timer)
    timers.delete(sessionId)
  }
  const sessionIds = Object.keys(messageQueueStore.getState().queues)
  await Promise.all(sessionIds.map((sessionId) => drainQueue(sessionId)))
}
