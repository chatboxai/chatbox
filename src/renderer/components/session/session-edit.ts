import type { SessionHeader } from '@chatbox/core/ports'
import { createMessage, type Session, type SessionSettings } from '@shared/types'
import { getMessageText } from '@shared/utils/message'

/** One change made from the conversation settings panel; applied immediately. */
export interface SessionEdit {
  name?: string
  /** Empty text removes the system prompt message. */
  systemPrompt?: string
  /** Keys set to undefined return to the inherited value. */
  settings?: Partial<SessionSettings>
  assistantAvatarKey?: string | null
  backgroundImage?: Session['backgroundImage'] | null
}

/** Every edit except the system prompt, which lives in the conversation's messages. */
export type SessionHeaderEdit = Omit<SessionEdit, 'systemPrompt'>

export function getSessionSystemPrompt(session: Pick<Session, 'messages'>): string {
  const systemMessage = session.messages.find((message) => message.role === 'system')
  return systemMessage ? getMessageText(systemMessage) : ''
}

export function applySessionEdit(session: Session, edit: SessionEdit): Session {
  const next = applySessionHeaderEdit(session, edit)
  if (edit.systemPrompt !== undefined) {
    const prompt = edit.systemPrompt.trim()
    const messages = [...session.messages]
    const index = messages.findIndex((message) => message.role === 'system')
    if (prompt === '') {
      next.messages = messages.filter((message) => message.role !== 'system')
    } else if (index >= 0) {
      messages[index] = { ...messages[index], contentParts: [{ type: 'text', text: prompt }] }
      next.messages = messages
    } else {
      next.messages = [createMessage('system', prompt), ...messages]
    }
  }
  return next
}

export function applySessionHeaderEdit<T extends SessionHeader>(header: T, edit: SessionHeaderEdit): T {
  const next: T = { ...header }
  if (edit.name !== undefined) {
    next.name = edit.name.trim() || header.name
  }
  if (edit.settings) {
    const settings: SessionSettings = { ...header.settings }
    for (const [key, value] of Object.entries(edit.settings) as [keyof SessionSettings, unknown][]) {
      if (value === undefined) delete settings[key]
      else Object.assign(settings, { [key]: value })
    }
    next.settings = settings
  }
  if (edit.assistantAvatarKey !== undefined) {
    next.assistantAvatarKey = edit.assistantAvatarKey ?? undefined
  }
  if (edit.backgroundImage !== undefined) {
    next.backgroundImage = edit.backgroundImage ?? undefined
  }
  return next
}
