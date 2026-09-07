import {
  collectToolCallSummaries,
  type ExportableThread,
  getAttachmentNames,
  stringifyDataForExport,
  type ToolCallSummary,
} from '@chatbox/core/utils/chat-export'
import type { Message, Session } from '@shared/types'
import { MantineProvider } from '@mantine/core'
import { escape as escapeHtml } from 'lodash'
import ReactDOMServer from 'react-dom/server'
import Markdown, { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import * as base64 from '@/packages/base64'
import storage from '@/storage'

// Plain-text Markdown / TXT exporters are shared with the native mobile shell.
export { formatChatAsMarkdown, formatChatAsTxt } from '@chatbox/core/utils/chat-export'

function renderToolCallHtml(summary: ToolCallSummary): string {
  let html = '<div class="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">\n'
  html += `<p class="font-semibold text-sm">${escapeHtml(summary.toolName)} <span class="text-xs text-slate-500">(state: ${escapeHtml(summary.state)})</span></p>\n`
  const argsText = stringifyDataForExport(summary.args)
  if (argsText) {
    html += '<p class="text-xs text-slate-500 mt-1 mb-1">Args</p>\n'
    html += `<pre class="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap overflow-x-auto">${escapeHtml(argsText)}</pre>\n`
  }
  const resultText = stringifyDataForExport(summary.result)
  if (resultText) {
    html += '<p class="text-xs text-slate-500 mt-2 mb-1">Result</p>\n'
    html += `<pre class="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap overflow-x-auto">${escapeHtml(resultText)}</pre>\n`
  }
  html += '</div>\n'
  return html
}

async function renderMessageHtml(message: Message): Promise<string> {
  const attachments = getAttachmentNames(message)
  const toolCallSummaries = collectToolCallSummaries(message)
  const renderedToolCalls = new Set<string>()
  let content = '<div class="chatbox-export-message mb-4">\n'
  if (message.role !== 'assistant') {
    content += `<p class="text-green-500 text-lg"><b>${message.role.toUpperCase()}: </b></p>\n`
  } else {
    content += `<p class="text-blue-500 text-lg"><b>${message.role.toUpperCase()}: </b></p>\n`
  }
  for (const part of message.contentParts) {
    if (part.type === 'tool-call') {
      if (renderedToolCalls.has(part.toolCallId)) {
        continue
      }
      const summary = toolCallSummaries.get(part.toolCallId)
      if (!summary) {
        continue
      }
      content += renderToolCallHtml(summary)
      renderedToolCalls.add(part.toolCallId)
      continue
    }
    if (part.type === 'text') {
      content += ReactDOMServer.renderToStaticMarkup(
        <MantineProvider>
          <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
            {/* 导出页面没有 theme，代码块应该总是使用 dark 否则 color scheme 看不清 */}
            <Markdown hiddenCodeActions forceColorScheme="dark">
              {part.text}
            </Markdown>
          </BlockCodeCollapsedStateProvider>
        </MantineProvider>
      )
    } else if (part.type === 'image' && part.storageKey) {
      let url = ''
      const b64 = await storage.getBlob(part.storageKey)
      if (b64) {
        let { type, data } = base64.parseImage(b64)
        if (type === '') {
          type = 'image/png'
          data = b64
        }
        url = `data:${type};base64,${data}`
      } else if ('url' in part) {
        url = part.url as string
      }
      content += `<img src="${escapeHtml(url)}" class="my-2" />\n`
    }
  }
  if (attachments.length > 0) {
    content += '<div class="mt-2">\n'
    content += '<p class="font-semibold text-sm mb-1">Attachments:</p>\n'
    content += '<ul class="list-disc pl-6 text-sm text-slate-600">\n'
    for (const name of attachments) {
      content += `<li>${escapeHtml(name)}</li>\n`
    }
    content += '</ul>\n'
    content += '</div>\n'
  }
  content += '</div>\n'
  return content
}

function renderHtmlDocument(sessionName: string, content: string, interactiveScript = ''): string {
  const escapedSessionName = escapeHtml(sessionName)
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapedSessionName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
    <link rel="shortcut icon" href="https://chatboxai.app/icon.png">
    <style>
      .chatbox-fork-navigation { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; margin: -0.5rem 1rem 0.75rem; color: #868e96; }
      .chatbox-fork-navigation button { appearance: none; border: 0; border-radius: 9999px; background: transparent; color: inherit; cursor: pointer; font-size: 1.25rem; line-height: 1; padding: 0.25rem 0.5rem; }
      .chatbox-fork-navigation button:hover { background: #f1f3f5; color: #495057; }
      .chatbox-fork-position { min-width: 3.5rem; text-align: center; font-size: 0.75rem; }
    </style>
</head>
<body class='bg-slate-100'>
    <div class='mx-auto max-w-5xl shadow-md prose bg-white px-2 py-4'>
        <h1 class='flex flex-row justify-between items-center my-4 h-8'>
            <span>${escapedSessionName}</span>
            <a href="https://chatboxai.app" target="_blank" >
                <img src='https://chatboxai.app/icon.png' class="w-12">
            </a>
        </h1>
        <hr />
        ${content}
        <hr />
        <a href="https://chatboxai.app" style="display: flex; align-items: center;" class="text-sky-500" target="_blank">
            <img src='https://chatboxai.app/icon.png' class="w-12 pr-2">
            <b style='font-size:30px'>Chatbox AI</b>
        </a>
        <p><a href="https://chatboxai.app" target="_blank">https://chatboxai.app</a></p>
    </div>
    ${interactiveScript}
</body>
</html>
`
}

export async function formatChatAsHtml(sessionName: string, threads: ExportableThread[]) {
  let content = '<div class="prose-sm">\n'
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]
    content += `<h2>${i + 1}. ${escapeHtml(thread.name)}</h2>\n`
    for (const msg of thread.messages) {
      content += await renderMessageHtml(msg)
    }
    content += '<hr />\n'
  }
  content += '</div>\n'
  return renderHtmlDocument(sessionName, content)
}

type InteractiveHtmlMessage = {
  html: string
  id: string
  isSummary: boolean
}

type InteractiveHtmlFork = {
  id: string
  lists: Array<{ id: string; messages: string[] }>
  position: number
}

type InteractiveHtmlExportData = {
  forks: InteractiveHtmlFork[]
  messages: InteractiveHtmlMessage[]
  threads: Array<{ messages: string[]; name: string }>
}

function collectInteractiveHtmlData(
  threads: ExportableThread[],
  messageForksHash: Session['messageForksHash']
): { forks: InteractiveHtmlFork[]; messages: Map<string, Message> } {
  const messages = new Map<string, Message>()
  const forkIds = new Set<string>()

  const visitMessages = (sequence: Message[]) => {
    for (const message of sequence) {
      messages.set(message.id, message)
      const fork = messageForksHash?.[message.id]
      if (!fork || forkIds.has(message.id)) {
        continue
      }
      forkIds.add(message.id)
      for (const branch of fork.lists) {
        visitMessages(branch.messages)
      }
    }
  }

  for (const thread of threads) {
    visitMessages(thread.messages)
  }

  return {
    messages,
    forks: Array.from(forkIds, (id) => {
      const fork = messageForksHash?.[id]
      return {
        id,
        position: fork?.position ?? 0,
        lists: (fork?.lists ?? []).map((list) => ({
          id: list.id,
          messages: list.messages.map((message) => message.id),
        })),
      }
    }),
  }
}

function serializeHtmlJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

const interactiveHtmlController = `
<script>
(() => {
  const dataElement = document.getElementById('chatbox-export-data')
  const root = document.getElementById('chatbox-export-root')
  if (!dataElement || !root) return

  const data = JSON.parse(dataElement.textContent || '{}')
  const messages = new Map(data.messages.map((message) => [message.id, message]))
  const forks = new Map(data.forks.map((fork) => [fork.id, fork]))
  const threads = data.threads

  const forkTailStartIndex = (messageIds, forkMessageIndex) => {
    let index = forkMessageIndex + 1
    while (index < messageIds.length && messages.get(messageIds[index])?.isSummary) index += 1
    return index
  }

  const renderThread = (threadIndex) => {
    const thread = threads[threadIndex]
    const section = document.createElement('section')
    section.dataset.threadIndex = String(threadIndex)

    const title = document.createElement('h2')
    title.textContent = String(threadIndex + 1) + '. ' + thread.name
    section.appendChild(title)

    for (const messageId of thread.messages) {
      const message = messages.get(messageId)
      if (!message) continue

      const wrapper = document.createElement('div')
      wrapper.dataset.messageId = messageId
      wrapper.innerHTML = message.html
      section.appendChild(wrapper)

      const fork = forks.get(messageId)
      if (!fork || fork.lists.length <= 1) continue

      const navigation = document.createElement('div')
      navigation.className = 'chatbox-fork-navigation'
      navigation.dataset.forkId = messageId

      const previous = document.createElement('button')
      previous.type = 'button'
      previous.textContent = '‹'
      previous.setAttribute('aria-label', 'Previous reply')
      previous.dataset.forkAction = 'prev'
      previous.dataset.threadIndex = String(threadIndex)
      previous.dataset.forkId = messageId

      const position = document.createElement('span')
      position.className = 'chatbox-fork-position'
      position.textContent = String(fork.position + 1) + ' / ' + String(fork.lists.length)

      const next = document.createElement('button')
      next.type = 'button'
      next.textContent = '›'
      next.setAttribute('aria-label', 'Next reply')
      next.dataset.forkAction = 'next'
      next.dataset.threadIndex = String(threadIndex)
      next.dataset.forkId = messageId

      navigation.append(previous, position, next)
      section.appendChild(navigation)
    }

    section.appendChild(document.createElement('hr'))
    const previousSection = root.querySelector('section[data-thread-index="' + String(threadIndex) + '"]')
    if (previousSection) previousSection.replaceWith(section)
    else root.appendChild(section)
  }

  const switchFork = (threadIndex, forkMessageId, direction) => {
    const fork = forks.get(forkMessageId)
    const thread = threads[threadIndex]
    if (!fork || !thread || fork.lists.length <= 1) return

    const forkMessageIndex = thread.messages.indexOf(forkMessageId)
    if (forkMessageIndex < 0) return

    const tailStart = forkTailStartIndex(thread.messages, forkMessageIndex)
    const currentTail = thread.messages.slice(tailStart)
    const currentPosition = fork.position
    const isCurrentBranchEmpty = currentTail.length === 0
    let updatedLists = fork.lists
    let adjustedCurrentPosition = currentPosition

    if (isCurrentBranchEmpty) {
      updatedLists = fork.lists.filter((_, index) => index !== currentPosition)
      if (updatedLists.length <= 1) {
        thread.messages = thread.messages.slice(0, tailStart).concat(updatedLists[0]?.messages || [])
        forks.delete(forkMessageId)
        renderThread(threadIndex)
        return
      }
      adjustedCurrentPosition = currentPosition >= updatedLists.length ? updatedLists.length - 1 : currentPosition
    }

    const total = updatedLists.length
    const newPosition = direction === 'next'
      ? (adjustedCurrentPosition + 1) % total
      : (adjustedCurrentPosition - 1 + total) % total
    const branchMessages = updatedLists[newPosition]?.messages || []

    fork.lists = updatedLists.map((list, index) => {
      if (!isCurrentBranchEmpty && index === adjustedCurrentPosition && adjustedCurrentPosition !== newPosition) {
        return { ...list, messages: currentTail }
      }
      if (index === newPosition) return { ...list, messages: [] }
      return list
    })
    fork.position = newPosition
    thread.messages = thread.messages.slice(0, tailStart).concat(branchMessages)
    renderThread(threadIndex)
  }

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-fork-action]') : null
    if (!button) return
    const threadIndex = Number(button.dataset.threadIndex)
    const forkMessageId = button.dataset.forkId
    const direction = button.dataset.forkAction
    if (!forkMessageId || (direction !== 'next' && direction !== 'prev')) return
    switchFork(threadIndex, forkMessageId, direction)
  })

  threads.forEach((_, index) => renderThread(index))
})()
</script>`

/**
 * HTML all-branch export keeps the stored fork representation intact. Each
 * unique message is rendered once into the payload; the page only inserts the
 * currently selected path into the DOM and applies the same tail swap used by
 * the application when a fork changes.
 */
export async function formatChatAsInteractiveHtml(
  sessionName: string,
  threads: ExportableThread[],
  messageForksHash: Session['messageForksHash']
): Promise<string> {
  const collected = collectInteractiveHtmlData(threads, messageForksHash)
  const renderedMessages: InteractiveHtmlMessage[] = []
  for (const message of collected.messages.values()) {
    renderedMessages.push({
      id: message.id,
      html: await renderMessageHtml(message),
      isSummary: Boolean(message.isSummary),
    })
  }

  const data: InteractiveHtmlExportData = {
    messages: renderedMessages,
    forks: collected.forks,
    threads: threads.map((thread) => ({
      name: thread.name,
      messages: thread.messages.map((message) => message.id),
    })),
  }
  const dataScript = `<div id="chatbox-export-root" class="prose-sm"></div>\n<script id="chatbox-export-data" type="application/json">${serializeHtmlJson(data)}</script>`
  return renderHtmlDocument(sessionName, dataScript, interactiveHtmlController)
}
