import type { SessionTranscriptCursor } from '@chatbox/core/ports'
import { isEmptyMessage } from '@shared/utils/message'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import { rendererApplication } from '@/app/renderer-application'
import { isSuccessfulAssistantReply } from './session/message-success'

export const FIRST_SUCCESSFUL_CHAT_KEY = 'chatbox:first-successful-chat:v1'

type FirstSuccessfulChatStorageValue = '0' | '1'

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const builtInTemplateSessionIds = new Set(
  [...defaultSessionsForEN, ...defaultSessionsForCN].map((session) => session.id)
)

function getBrowserLocalStorage(): BrowserStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function readStoredValue(): { available: boolean; value: FirstSuccessfulChatStorageValue | null } {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return { available: false, value: null }

  try {
    const value = localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)
    return { available: true, value: value === '0' || value === '1' ? value : null }
  } catch {
    return { available: false, value: null }
  }
}

function writeStoredValue(value: FirstSuccessfulChatStorageValue): boolean {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return false

  try {
    localStorage.setItem(FIRST_SUCCESSFUL_CHAT_KEY, value)
    return true
  } catch {
    return false
  }
}

export function markFirstSuccessfulChatCompleted(): void {
  writeStoredValue('1')
}

export function resetFirstSuccessfulChatForDebug(): void {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return

  try {
    localStorage.removeItem(FIRST_SUCCESSFUL_CHAT_KEY)
  } catch {
    // Ignore storage failures in debug reset paths.
  }
}

async function inferFirstSuccessfulChatCompletedFromSessions(): Promise<boolean> {
  const sessionMetas = await rendererApplication.sessions.listAllSessionsMeta()
  for (const meta of sessionMetas) {
    if (builtInTemplateSessionIds.has(meta.id)) continue
    if (meta.hidden) continue
    if (meta.type && meta.type !== 'chat') continue

    let cursor: SessionTranscriptCursor | undefined
    let threadId: string | undefined
    let laterSuccessfulReply = false
    do {
      const page = await rendererApplication.sessions.readSessionTranscriptWindow({
        sessionId: meta.id,
        origin: 'tail',
        limit: 50,
        cursor,
      })
      if (!page) break
      for (const row of [...page.messages].reverse()) {
        if (row.threadId !== threadId) {
          threadId = row.threadId
          laterSuccessfulReply = false
        }
        if (isSuccessfulAssistantReply(row.message)) laterSuccessfulReply = true
        if (laterSuccessfulReply && row.message.role === 'user' && !isEmptyMessage(row.message)) return true
      }
      cursor = page.older ?? undefined
      if (cursor) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    } while (cursor)
  }

  return false
}

export async function getHasCompletedFirstSuccessfulChat(): Promise<boolean> {
  const { available, value } = readStoredValue()
  if (value === '1') return true
  if (value === '0') return false

  if (!available) {
    return true
  }

  try {
    const inferred = await inferFirstSuccessfulChatCompletedFromSessions()
    writeStoredValue(inferred ? '1' : '0')
    return inferred
  } catch (error) {
    console.warn('[firstSuccessfulChat] failed to infer first successful chat state:', error)
    return true
  }
}
