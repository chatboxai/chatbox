// 有时候直接操作 DOM 依然是最方便、性能最好的方式，这里对 DOM 操作进行统一管理

// ------ 消息输入框 ------

export const InputBoxID = 'input-box-2024-02-22'

export function getInputBoxHeight(): number {
  const element = document.getElementById(InputBoxID)
  if (!element) {
    return 0
  }
  return element.clientHeight
}

// ------ 消息输入框表单(input) ------

export const messageInputID = 'message-input'

export const focusMessageInput = () => {
  document.getElementById(messageInputID)?.focus()
}

export const blurMessageInput = () => {
  document.getElementById(messageInputID)?.blur()
}

// 将光标位置设置为文本末尾
export function setMessageInputCursorToEnd() {
  const dom = document.getElementById(messageInputID) as HTMLTextAreaElement
  if (!dom) {
    return
  }
  dom.selectionStart = dom.selectionEnd = dom.value.length
  setTimeout(() => {
    dom.scrollTop = dom.scrollHeight
  }, 20) // 等待 React 状态更新
}
