import { LEGACY_PROVIDER_MODEL_KEYS, migrateLegacyProviderSettings } from '@shared/migration/legacy-provider-settings'
import { ModelProviderEnum, ModelProviderType } from '@shared/types/provider'
import { convertLegacyTreeToRowFormat, legacyActiveThreadId } from '../application/session/compatibility/row-format'
import { migrateSession } from '../application/session/compatibility/session-load'
import { encodeSessionTree } from '../session/session-tree/encode'
import type { Session } from '../types/session'
import { toBackupSession, toBackupThread, toBackupMessage } from '../backup-v3/schema'
import type { BackupBusinessRecord, BackupImportProjections } from '../backup-v3/types'

export const GLOBAL_KEYS = [
  'settings',
  'myCopilots',
  'chat-session-settings',
  'picture-session-settings',
  'session-folders',
  'agent-soul',
  'agent-memories',
  'copilot-memories',
  'copilot-memory-owners',
  'copilot-memory-state-tokens',
] as const
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy backup object')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid legacy backup collection')
  return value
}
const customProviderId = (archiveId: string, index: number) => `custom-provider-${archiveId}-${index}`

export function normalizeSettings(
  value: unknown,
  configVersion: number | undefined,
  archiveId: string
): Record<string, unknown> {
  const settings = object(value)
  if (
    !settings.providers &&
    ((configVersion !== undefined && configVersion < 10) || typeof settings.aiProvider === 'string')
  ) {
    const { customProviders: oldCustomProviders, ...builtInSettings } = settings
    const migrated = migrateLegacyProviderSettings(builtInSettings)
    for (const [index, entry] of (oldCustomProviders === undefined ? [] : array(oldCustomProviders)).entries()) {
      const provider = object(entry)
      const id = customProviderId(archiveId, index)
      const models = [
        ...new Set([
          ...(provider.modelOptions === undefined ? [] : array(provider.modelOptions)),
          provider.model || '',
        ]),
      ].filter(Boolean)
      if (models.some((model) => typeof model !== 'string')) throw new Error('Invalid legacy provider models')
      migrated.customProviders.push({
        id,
        name: typeof provider.name === 'string' ? provider.name : '',
        isCustom: true,
        type: ModelProviderType.OpenAI,
      })
      migrated.providers[id] = {
        apiKey: provider.key as string | undefined,
        apiHost: provider.host as string | undefined,
        apiPath: provider.path as string | undefined,
        useProxy: provider.useProxy as boolean | undefined,
        models: (models as string[]).map((modelId) => ({ modelId })),
      }
    }
    return { ...settings, ...migrated }
  }
  return settings
}

/** Converts only keys that are explicitly present in the external backup. */
export function* globalRecords(
  key: string,
  value: unknown,
  configVersion: number | undefined,
  archiveId: string
): Generator<BackupBusinessRecord> {
  const row = (
    category: Extract<BackupBusinessRecord, { type: 'global' }>['category'],
    id: string,
    data: unknown
  ): BackupBusinessRecord => ({ type: 'global', category, id, value: data })
  if (key === 'settings') yield row('settings', key, normalizeSettings(value, configVersion, archiveId))
  else if (key === 'agent-soul') yield row('soul', key, value)
  else if (key.endsWith('-session-settings')) yield row('session-settings', key, object(value))
  else if (key === 'copilot-memories') {
    for (const [id, memory] of Object.entries(object(value))) yield row('copilot-memory', id, array(memory))
  } else {
    const category =
      key === 'myCopilots'
        ? 'copilot'
        : key === 'session-folders'
          ? 'folder'
          : key === 'agent-memories'
            ? 'global-memory'
            : 'memory-identities'
    for (const entry of array(value)) {
      const item = object(entry)
      if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid legacy global identity')
      const id =
        key === 'copilot-memory-owners'
          ? `owner:${item.id}`
          : key === 'copilot-memory-state-tokens'
            ? `token:${item.id}`
            : item.id
      yield row(category, id, item)
    }
  }
}

export interface ConvertedLegacySession {
  records: BackupBusinessRecord[]
  forks: BackupImportProjections['forks']
}

export function convertSession(
  value: unknown,
  expectedId: string | undefined,
  globals: Record<string, unknown>,
  configVersion: number | undefined,
  archiveId: string
): ConvertedLegacySession {
  const input = object(value)
  if (typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || !Array.isArray(input.messages))
    throw new Error('Invalid legacy conversation')
  if (expectedId !== undefined && input.id !== expectedId)
    throw new Error('Legacy conversation identity does not match')
  let settings = input.settings === undefined ? {} : object(input.settings)
  if (
    typeof settings.provider !== 'string' &&
    ((configVersion !== undefined && configVersion < 10) || typeof settings.aiProvider === 'string')
  ) {
    let provider = settings.aiProvider ?? globals.aiProvider
    if (input.type === 'picture') {
      const allowed = new Set<string>([ModelProviderEnum.ChatboxAI, ModelProviderEnum.OpenAI, ModelProviderEnum.Azure])
      provider =
        typeof globals.aiProvider === 'string' && allowed.has(globals.aiProvider)
          ? globals.aiProvider
          : ModelProviderEnum.ChatboxAI
      settings = {
        ...settings,
        provider,
        modelId: 'DALL-E-3',
        imageGenerateNum: settings.imageGenerateNum ?? 3,
        dalleStyle: settings.dalleStyle ?? 'vivid',
      }
    } else if (provider === ModelProviderEnum.Custom) {
      const selectedId = settings.selectedCustomProviderId || globals.selectedCustomProviderId
      const definitions = Array.isArray(globals.customProviders) ? globals.customProviders.map(object) : []
      const index = definitions.findIndex((entry) => typeof selectedId === 'string' && entry.id === selectedId)
      if (index >= 0) {
        const local = Array.isArray(settings.customProviders)
          ? settings.customProviders.map(object).find((entry) => entry.id === selectedId)
          : undefined
        settings = {
          ...settings,
          provider: customProviderId(archiveId, index),
          modelId: local?.model ?? definitions[index].model,
        }
      }
    } else if (typeof provider === 'string') {
      const modelKey = LEGACY_PROVIDER_MODEL_KEYS[provider]
      settings = { ...settings, provider, modelId: modelKey ? (settings[modelKey] ?? globals[modelKey]) : undefined }
    }
  }
  const session = migrateSession({ ...input, settings } as unknown as Session)
  const encoded = encodeSessionTree(session, { activeThreadId: legacyActiveThreadId(session), now: 0 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const converted = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
  return {
    records: [
      { type: 'session', session: toBackupSession(converted.session) },
      ...converted.threads.map((thread): BackupBusinessRecord => ({ type: 'thread', thread: toBackupThread(thread) })),
      ...converted.messages.map(
        (message): BackupBusinessRecord => ({ type: 'message', message: toBackupMessage(message) })
      ),
    ],
    forks: new Map(
      converted.messages.flatMap((message) => (message.fork ? [[message.messageId, message.fork] as const] : []))
    ),
  }
}
