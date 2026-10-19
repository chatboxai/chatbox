import type { SessionTranscriptViewportAnchor } from '@chatbox/react/query'

const BLOCK_ATTRIBUTE = 'data-transcript-block'
const BLOCK_SELECTOR = `[${BLOCK_ATTRIBUTE}]`
const MESSAGE_SELECTOR = '[data-transcript-message]'

type ContentAnchor = Pick<SessionTranscriptViewportAnchor, 'messageId' | 'blockId' | 'offset' | 'messageOffset'>
interface BlockPosition {
  id: string
  path?: number[]
  character?: number
  blockOffset: number
}
interface BlockEntry {
  element: HTMLElement
  messageId: string
  id: string
  visible: boolean
  width: number
  height: number
}
interface Options {
  viewport(): HTMLElement | null
  suspended(): boolean
  scrollBy(delta: number): void
}

type CaretDocument = Document & {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?(x: number, y: number): Range | null
}

function positionFromId(value: string | undefined): BlockPosition | null {
  if (!value) return null
  try {
    const position = JSON.parse(value) as Partial<BlockPosition>
    if (typeof position.id !== 'string' || !Number.isFinite(position.blockOffset)) return null
    if (
      position.path !== undefined &&
      (!Array.isArray(position.path) ||
        position.path.length > 64 ||
        position.path.some((index) => !Number.isSafeInteger(index) || index < 0))
    )
      return null
    if (position.character !== undefined && (!Number.isSafeInteger(position.character) || position.character < 0))
      return null
    return position as BlockPosition
  } catch {
    return null
  }
}

function textPath(block: HTMLElement, node: Node): number[] | null {
  const path: number[] = []
  let current: Node | null = node
  while (current && current !== block && path.length < 64) {
    const parent: ParentNode | null = current.parentNode
    if (!parent) return null
    let start = 0
    let end = parent.childNodes.length
    while (start < end) {
      const middle = (start + end) >>> 1
      const sibling = parent.childNodes[middle]
      if (sibling === current) {
        start = middle
        break
      }
      if (sibling.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING) start = middle + 1
      else end = middle
    }
    path.unshift(start)
    current = parent as Node
  }
  return current === block ? path : null
}

function rangeAt(block: HTMLElement, path: number[], character: number): Range | null {
  let node: Node = block
  for (const index of path) {
    const child = node.childNodes[index]
    if (!child) return null
    node = child
  }
  if (node.nodeType !== Node.TEXT_NODE || character >= (node.textContent?.length ?? 0)) return null
  const range = block.ownerDocument.createRange()
  range.setStart(node, character)
  range.setEnd(node, character + 1)
  return range
}

/** Keeps a point at the position implied by the user's actual scroll delta. */
export function shiftTranscriptContentAnchor<T extends ContentAnchor>(anchor: T, delta: number): T {
  const position = positionFromId(anchor.blockId)
  return {
    ...anchor,
    offset: anchor.offset - delta,
    messageOffset: anchor.messageOffset === undefined ? undefined : anchor.messageOffset - delta,
    blockId: position ? JSON.stringify({ ...position, blockOffset: position.blockOffset - delta }) : anchor.blockId,
  }
}

/** Tracks only mounted Markdown blocks. Capture performs logarithmic geometry lookup, never Markdown parsing. */
export function createTranscriptContentAnchor(options: Options) {
  const entries = new Map<HTMLElement, BlockEntry>()
  const messages = new Map<string, HTMLElement>()
  const identities = new Map<string, Map<string, BlockEntry>>()
  let ordered: BlockEntry[] = []
  let orderDirty = true
  let root: HTMLElement | null = null
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  let readingAnchor: ContentAnchor | null = null
  let frame: number | null = null
  let userTimer: ReturnType<typeof setTimeout> | undefined
  let userScrolling = false
  let lastScrollTop = 0
  let viewportSize: { width: number; height: number } | null = null
  let attempts = 0
  let stableFrames = 0

  const readViewportSize = () => {
    const bounds = options.viewport()?.getBoundingClientRect()
    return bounds ? { width: bounds.width, height: bounds.height } : null
  }
  const cancelFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }
  const unregister = (element: HTMLElement) => {
    const entry = entries.get(element)
    if (!entry) return
    entries.delete(element)
    const message = identities.get(entry.messageId)
    if (message?.get(entry.id) === entry) message.delete(entry.id)
    if (message?.size === 0) identities.delete(entry.messageId)
    resizeObserver?.unobserve(element)
    orderDirty = true
  }
  const register = (element: HTMLElement) => {
    if (!root?.contains(element)) return
    const messageElement = element.closest<HTMLElement>(MESSAGE_SELECTOR)
    const messageId = messageElement?.dataset.transcriptMessage
    const id = element.getAttribute(BLOCK_ATTRIBUTE)
    if (!messageId || !id || !messageElement) return
    messages.set(messageId, messageElement)
    const old = entries.get(element)
    if (old?.messageId === messageId && old.id === id) return
    unregister(element)
    const bounds = element.getBoundingClientRect()
    const entry = { element, messageId, id, visible: bounds.height > 0, width: bounds.width, height: bounds.height }
    entries.set(element, entry)
    let message = identities.get(messageId)
    if (!message) identities.set(messageId, (message = new Map()))
    message.set(id, entry)
    resizeObserver?.observe(element)
    orderDirty = true
  }
  const forBlocks = (node: Node, callback: (element: HTMLElement) => void) => {
    if (!(node instanceof HTMLElement)) return
    if (node.matches(BLOCK_SELECTOR)) callback(node)
    for (const element of Array.from(node.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) callback(element)
  }
  const rebuildOrder = () => {
    if (orderDirty) {
      ordered = Array.from(entries.values()).filter((entry) => entry.visible)
      ordered.sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      orderDirty = false
    }
  }
  const capture = (): ContentAnchor | null => {
    const viewport = options.viewport()
    if (!viewport || !root) return null
    const bounds = viewport.getBoundingClientRect()
    let start = 0
    let end = ordered.length
    while (start < end) {
      const middle = (start + end) >>> 1
      if (ordered[middle].element.getBoundingClientRect().bottom <= bounds.top) start = middle + 1
      else end = middle
    }
    const entry = ordered[start]
    if (!entry || !entry.element.isConnected) return null
    const block = entry.element.getBoundingClientRect()
    if (block.top >= bounds.bottom) return null
    const position: BlockPosition = {
      id: entry.id,
      blockOffset: block.top - bounds.top,
    }
    let offset = position.blockOffset
    const document = entry.element.ownerDocument as CaretDocument
    const x = Math.max(bounds.left + 2, Math.min(block.left + 16, bounds.right - 2))
    const y = Math.max(block.top + 2, bounds.top + 8)
    const caret = document.caretPositionFromPoint?.(x, y)
    const browserRange = caret ? null : document.caretRangeFromPoint?.(x, y)
    const node = caret?.offsetNode ?? browserRange?.startContainer
    const character = caret?.offset ?? browserRange?.startOffset
    if (node?.nodeType === Node.TEXT_NODE && character !== undefined && entry.element.contains(node)) {
      const path = textPath(entry.element, node)
      const range = path ? rangeAt(entry.element, path, character) : null
      const rect = range?.getBoundingClientRect()
      if (path && rect && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom) {
        position.path = path
        position.character = character
        offset = rect.top - bounds.top
      }
    }
    return {
      messageId: entry.messageId,
      blockId: JSON.stringify(position),
      offset,
      messageOffset:
        (entry.element.closest<HTMLElement>(MESSAGE_SELECTOR)?.getBoundingClientRect().top ?? block.top) - bounds.top,
    }
  }
  const correction = (anchor: ContentAnchor): number | null => {
    const position = positionFromId(anchor.blockId)
    const viewport = options.viewport()
    const entry = position && anchor.messageId ? identities.get(anchor.messageId)?.get(position.id) : undefined
    if (!viewport) return null
    if (!position || !entry?.element.isConnected) {
      const message = anchor.messageId ? messages.get(anchor.messageId) : null
      return message?.isConnected
        ? message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - messageOffset(anchor)
        : null
    }
    const range =
      position.path && position.character !== undefined
        ? rangeAt(entry.element, position.path, position.character)
        : null
    const rect = range?.getBoundingClientRect()
    if (rect && rect.height > 0) return rect.top - viewport.getBoundingClientRect().top - anchor.offset
    return entry.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - position.blockOffset
  }
  const isVisible = (anchor: ContentAnchor) => {
    const position = positionFromId(anchor.blockId)
    const entry = position && anchor.messageId ? identities.get(anchor.messageId)?.get(position.id) : undefined
    const viewport = options.viewport()?.getBoundingClientRect()
    if (!viewport) return false
    if (!entry) {
      const message = anchor.messageId ? messages.get(anchor.messageId) : null
      const bounds = message?.isConnected ? message.getBoundingClientRect() : null
      return !!bounds && bounds.bottom > viewport.top && bounds.top < viewport.bottom
    }
    const range =
      position?.path && position.character !== undefined
        ? rangeAt(entry.element, position.path, position.character)
        : null
    const point = range?.getBoundingClientRect()
    const bounds = point?.height ? point : entry.element.getBoundingClientRect()
    return bounds.bottom > viewport.top && bounds.top < viewport.bottom
  }
  const messageOffset = (anchor: ContentAnchor) => anchor.messageOffset ?? anchor.offset
  const releaseReadingAnchor = () => {
    cancelFrame()
    readingAnchor = null
    attempts = 0
    stableFrames = 0
    lastScrollTop = options.viewport()?.scrollTop ?? 0
    viewportSize = readViewportSize()
  }
  const remember = () => {
    readingAnchor = options.suspended() ? null : capture()
    lastScrollTop = options.viewport()?.scrollTop ?? 0
    viewportSize = readViewportSize()
  }
  const adopt = (anchor: ContentAnchor | null) => {
    cancelFrame()
    readingAnchor = anchor?.blockId ? anchor : capture()
    lastScrollTop = options.viewport()?.scrollTop ?? 0
    viewportSize = readViewportSize()
  }
  const restore = () => {
    frame = null
    if (options.suspended()) {
      releaseReadingAnchor()
      return
    }
    if (!readingAnchor) return
    const delta = correction(readingAnchor)
    if (delta === null) {
      readingAnchor = capture()
      lastScrollTop = options.viewport()?.scrollTop ?? 0
      viewportSize = readViewportSize()
      return
    }
    if (Math.abs(delta) > 0.5) {
      stableFrames = 0
      options.scrollBy(delta)
      lastScrollTop = options.viewport()?.scrollTop ?? 0
    } else stableFrames++
    viewportSize = readViewportSize()
    if (++attempts < 12 && stableFrames < 2) frame = requestAnimationFrame(restore)
    else if (stableFrames >= 2 && !isVisible(readingAnchor)) readingAnchor = capture()
  }
  const reflow = () => {
    if (options.suspended()) {
      releaseReadingAnchor()
      return
    }
    if (frame !== null || !readingAnchor) return
    attempts = 0
    stableFrames = 0
    // The virtual list measures its rows before we restore any remaining content displacement.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore)
    })
  }
  const userSettled = () => {
    if (userTimer !== undefined) clearTimeout(userTimer)
    userTimer = setTimeout(() => {
      userTimer = undefined
      userScrolling = false
      if (frame === null) remember()
    }, 120)
  }
  const onUserInput = () => {
    if (options.suspended()) releaseReadingAnchor()
    else if (!userScrolling || !readingAnchor) {
      readingAnchor ??= capture()
      lastScrollTop = options.viewport()?.scrollTop ?? 0
    }
    userScrolling = true
    userSettled()
  }
  const onScroll = () => {
    const scrollTop = options.viewport()?.scrollTop ?? 0
    const delta = scrollTop - lastScrollTop
    const size = readViewportSize()
    const viewportChanged =
      viewportSize && size && (viewportSize.width !== size.width || viewportSize.height !== size.height)
    if (options.suspended()) releaseReadingAnchor()
    else if (delta) {
      if (userScrolling && readingAnchor && (frame !== null || viewportChanged))
        readingAnchor = shiftTranscriptContentAnchor(readingAnchor, delta)
      else if (!readingAnchor || !viewportChanged) {
        readingAnchor = capture()
        viewportSize = size
      }
      if (viewportChanged) reflow()
    }
    if (userScrolling) userSettled()
    lastScrollTop = scrollTop
  }
  const disconnect = () => {
    cancelFrame()
    if (userTimer !== undefined) clearTimeout(userTimer)
    userTimer = undefined
    userScrolling = false
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
    mutationObserver = null
    resizeObserver = null
    entries.clear()
    messages.clear()
    identities.clear()
    ordered = []
    orderDirty = true
    readingAnchor = null
    viewportSize = null
    root = null
  }
  const connect = (element: HTMLElement) => {
    disconnect()
    root = element
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((records) => {
        let changed = false
        for (const record of records) {
          if (record.target === options.viewport()) {
            const size = readViewportSize()
            changed ||= !!(
              size &&
              viewportSize &&
              (size.width !== viewportSize.width || size.height !== viewportSize.height)
            )
          }
          const entry = entries.get(record.target as HTMLElement)
          if (!entry) continue
          const bounds = entry.element.getBoundingClientRect()
          changed ||= bounds.width !== entry.width || bounds.height !== entry.height
          entry.width = bounds.width
          entry.height = bounds.height
          const visible = bounds.height > 0
          if (visible !== entry.visible) {
            entry.visible = visible
            orderDirty = true
          }
        }
        rebuildOrder()
        if (changed) reflow()
      })
      if (options.viewport()) resizeObserver.observe(options.viewport()!)
    }
    forBlocks(element, register)
    rebuildOrder()
    mutationObserver = new MutationObserver((records) => {
      const contentChanged = records.some((record) => {
        const element = record.target instanceof HTMLElement ? record.target : record.target.parentElement
        const message = element?.closest<HTMLElement>(MESSAGE_SELECTOR)
        const id = message?.dataset.transcriptMessage
        return !!id && messages.get(id) === message
      })
      for (const record of records) {
        if (record.type === 'attributes') {
          unregister(record.target as HTMLElement)
          register(record.target as HTMLElement)
        } else {
          record.removedNodes.forEach((node) => forBlocks(node, unregister))
          record.addedNodes.forEach((node) => forBlocks(node, register))
        }
      }
      for (const [id, message] of messages) if (!root?.contains(message)) messages.delete(id)
      rebuildOrder()
      if (contentChanged) reflow()
    })
    mutationObserver.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [BLOCK_ATTRIBUTE],
    })
  }
  return {
    connect,
    disconnect,
    capture,
    correction,
    isVisible,
    messageOffset,
    remember,
    adopt,
    reflow,
    onUserInput,
    onScroll,
  }
}
