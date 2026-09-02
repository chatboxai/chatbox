import { buildMessageRenderItems } from '@/components/chat/message-render-items'
import { rendererApplication } from '@/app/renderer-application'
import { getAllMessageList } from './sessionHelpers'
import { uiStore } from './uiStore'

// scrollToMessage 滚动到指定消息，如果消息不存在则返回 false
export async function scrollToMessage(
  sessionId: string,
  msgId: string,
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' 立即滚动到指定位置，'smooth' 平滑滚动到指定位置
): Promise<boolean> {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
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
  scrollToIndex(itemIndex, align, behavior)
  return true
}

export function scrollToIndex(
  index: number | 'LAST',
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' 立即滚动到指定位置，'smooth' 平滑滚动到指定位置
) {
  const virtuoso = uiStore.getState().messageScrolling
  virtuoso?.current?.scrollToIndex({ index, align, behavior })
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
