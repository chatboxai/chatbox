import { type SessionHeader, type SessionSettings } from '@shared/types'

/** One change made from the conversation settings panel; applied immediately. */
export interface SessionEdit {
  name?: string
  /** Empty text removes the system prompt message. */
  systemPrompt?: string
  /** Keys set to undefined return to the inherited value. */
  settings?: Partial<SessionSettings>
  assistantAvatarKey?: string | null
  backgroundImage?: SessionHeader['backgroundImage'] | null
}

export function applySessionEdit(session: SessionHeader, edit: SessionEdit): SessionHeader {
  const next: SessionHeader = { ...session }
  if (edit.name !== undefined) next.name = edit.name.trim() || session.name
  if (edit.settings) {
    const settings: SessionSettings = { ...session.settings }
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
