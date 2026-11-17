import { uiStore } from './uiStore'

/** Navigate through the mounted row window and wait for the target read. */
export async function scrollToMessage(
  sessionId: string,
  messageId: string,
  _align: 'start' | 'center' | 'end' = 'start',
  _behavior: 'auto' | 'smooth' = 'auto'
): Promise<boolean> {
  const deadline = performance.now() + 1000
  return new Promise<boolean>((resolve) => {
    let settled = false
    let frame: number | undefined
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      resolve(result)
    }
    const timer = setTimeout(() => finish(false), 1000)
    const locate = () => {
      if (settled) return
      if (performance.now() >= deadline) return finish(false)
      const navigation = uiStore.getState().transcriptNavigation
      if (navigation?.sessionId !== sessionId) {
        frame = requestAnimationFrame(locate)
        return
      }
      try {
        void navigation.navigateMessage(messageId).then(
          (applied) =>
            finish(
              applied &&
                performance.now() < deadline &&
                uiStore.getState().transcriptNavigation?.owner === navigation.owner
            ),
          () => finish(false)
        )
      } catch {
        finish(false)
      }
    }
    locate()
  })
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
