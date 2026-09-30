import { rendererApplication } from '@/app/renderer-application'
import { buildMessageRenderItems } from '@/components/chat/message-render-items'
import { getAllMessageList } from './sessionHelpers'
import { type TranscriptNavigation, uiStore } from './uiStore'

function nextFrame(deadline: number): Promise<boolean> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame)
      resolve(false)
    }, remaining)
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve(performance.now() < deadline)
    })
  })
}

function currentCompleteTranscript(sessionId: string) {
  const state = uiStore.getState()
  const container = state.messageListElement?.current
  const handle = state.transcriptNavigation
  if (
    !container?.isConnected ||
    container.dataset.sessionId !== sessionId ||
    container.dataset.sessionView !== 'complete' ||
    handle?.sessionId !== sessionId ||
    handle.view !== 'complete'
  ) {
    return null
  }
  const list = container.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
  // Virtuoso hides the list until it has performed its initial index positioning.
  // A navigation sent before that point can be overwritten by that positioning.
  if (!list || getComputedStyle(list).visibility === 'hidden') return null
  return { container, handle, list }
}

function containsVisibleMessage(container: HTMLElement, list: HTMLElement, messageId: string): boolean {
  const message = Array.from(list.querySelectorAll<HTMLElement>('[id]')).find((element) => element.id === messageId)
  if (!message || getComputedStyle(message).visibility === 'hidden') return false
  const bounds = message.getBoundingClientRect()
  const viewport = container.getBoundingClientRect()
  return (
    Math.min(bounds.bottom, viewport.bottom) > Math.max(bounds.top, viewport.top) &&
    Math.min(bounds.right, viewport.right) > Math.max(bounds.left, viewport.left)
  )
}

// Success means the target is visible in the current session's complete transcript.
export async function scrollToMessage(
  sessionId: string,
  msgId: string,
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' 立即滚动到指定位置，'smooth' 平滑滚动到指定位置
): Promise<boolean> {
  const mountedContainer = uiStore.getState().messageListElement?.current
  const owner = mountedContainer?.dataset.sessionId === sessionId ? mountedContainer : null
  const initialNavigation = owner ? uiStore.getState().transcriptNavigation : null
  const session = await rendererApplication.sessionQueryBridge.requireCompleteSessionView(sessionId)
  if (!session) {
    return false
  }
  const currentMessages = getAllMessageList(session)
  if (!currentMessages) {
    return false
  }
  // Virtuoso items don't map 1:1 to messages: MessageList groups the latest user turn
  // with its assistant reply into a single item, so locate the item containing the message.
  const itemIndex = buildMessageRenderItems(currentMessages).findIndex((item) =>
    item.messages.some((message) => message.id === msgId)
  )
  if (itemIndex === -1) {
    return false
  }
  return navigateCompleteTranscript({
    sessionId,
    initialNavigation,
    isCurrent: () => !owner || uiStore.getState().messageListElement?.current === owner,
    messageId: msgId,
    navigate: (handle) => handle.scrollToIndex({ index: itemIndex, align, behavior }),
  })
}

/** Executes an explicit target after the complete list's initial positioning, then confirms it is visible. */
export async function navigateCompleteTranscript({
  sessionId,
  initialNavigation,
  isCurrent,
  messageId,
  edge = 'head',
  navigate,
}: {
  sessionId: string
  initialNavigation: TranscriptNavigation | null
  isCurrent: () => boolean
  messageId?: string
  edge?: 'head' | 'tail'
  navigate: (handle: TranscriptNavigation) => boolean
}): Promise<boolean> {
  const deadline = performance.now() + 1000
  let view = currentCompleteTranscript(sessionId)
  while (!view && performance.now() < deadline) {
    if (!isCurrent()) return false
    if (!(await nextFrame(deadline))) return false
    view = currentCompleteTranscript(sessionId)
  }
  if (!view || !isCurrent() || performance.now() >= deadline) return false
  if (initialNavigation && view.handle.owner !== initialNavigation.owner) return false
  if (initialNavigation?.view === 'complete' && view.handle !== initialNavigation) return false
  if (!navigate(view.handle)) return false

  do {
    if (!(await nextFrame(deadline)) || !isCurrent()) return false
    const current = currentCompleteTranscript(sessionId)
    if (current?.container !== view.container || current.handle !== view.handle || current.list !== view.list) {
      return false
    }
    if (messageId) {
      if (containsVisibleMessage(view.container, view.list, messageId)) return true
    } else {
      const scroller = view.container.querySelector<HTMLElement>('[data-virtuoso-scroller]')
      if (scroller) {
        const distance =
          edge === 'tail' ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : scroller.scrollTop
        if (Math.abs(distance) <= 1) return true
      }
    }
  } while (performance.now() < deadline)
  return false
}

export function scrollToIndex(
  index: number | 'LAST',
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' 立即滚动到指定位置，'smooth' 平滑滚动到指定位置
) {
  uiStore.getState().transcriptNavigation?.scrollToIndex({ index, align, behavior })
}

export function scrollToTop(behavior: 'auto' | 'smooth' = 'auto') {
  clearAutoScroll()
  return scrollToIndex(0, 'start', behavior)
}

export function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
  clearAutoScroll()
  return scrollToIndex('LAST', 'end', behavior)
}

let autoScrollTask: {
  id: string
  task: {
    msgId: string
    align: 'start' | 'center' | 'end'
    behavior: 'auto' | 'smooth'
  }
} | null = null

export function startAutoScroll(
  msgId: string,
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' 立即滚动到指定位置，'smooth' 平滑滚动到指定位置
): string {
  const newTask = { msgId, align, behavior }
  const newId = JSON.stringify(newTask)
  if (autoScrollTask) {
    if (autoScrollTask.id === newId) {
      return autoScrollTask.id
    } else {
      clearAutoScroll()
    }
  }
  autoScrollTask = {
    id: newId,
    task: newTask,
  }
  return newId
}

export function clearAutoScroll(id?: string) {
  if (!autoScrollTask) {
    return true
  }
  if (id && id !== autoScrollTask.id) {
    return false
  }
  autoScrollTask = null
  return true
}

export function getMessageListViewportHeight() {
  const messageListElement = uiStore.getState().messageListElement
  if (!messageListElement) {
    return 0
  }
  return messageListElement.current?.clientHeight ?? 0
}
