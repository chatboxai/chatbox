import type { Settings } from '@shared/types'

export type MessageMetaKey =
  | 'showModelName'
  | 'showMessageTimestamp'
  | 'showWordCount'
  | 'showTokenUsed'
  | 'showFirstTokenLatency'

/** Message info chips, with the value each item takes when the setting is unset, matching how messages read it. */
export const MESSAGE_META_OPTIONS: { key: MessageMetaKey; label: string; defaultValue: boolean }[] = [
  { key: 'showModelName', label: 'Model name', defaultValue: true },
  { key: 'showMessageTimestamp', label: 'Time', defaultValue: false },
  { key: 'showWordCount', label: 'Word count', defaultValue: false },
  { key: 'showTokenUsed', label: 'Token usage', defaultValue: true },
  { key: 'showFirstTokenLatency', label: 'First token latency', defaultValue: false },
]

export function getSelectedMessageMeta(settings: Partial<Pick<Settings, MessageMetaKey>>): MessageMetaKey[] {
  return MESSAGE_META_OPTIONS.filter((option) => settings[option.key] ?? option.defaultValue).map(
    (option) => option.key
  )
}

/** Settings update for a new chip selection; every item is written explicitly. */
export function getMessageMetaUpdate(selected: readonly string[]): Pick<Settings, MessageMetaKey> {
  return Object.fromEntries(MESSAGE_META_OPTIONS.map((option) => [option.key, selected.includes(option.key)])) as Pick<
    Settings,
    MessageMetaKey
  >
}
