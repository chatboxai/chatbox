import type { LegacyBackupDataStore } from '@chatbox/core/backup'
import type { SessionTranscriptCursor } from '@chatbox/core/ports'
import {
  LEGACY_PROVIDER_MODEL_KEYS,
  type LegacyFlatSettings,
  migrateLegacyProviderSettings,
} from '@shared/migration/legacy-provider-settings'
import {
  type ImageGeneration,
  type Message,
  ModelProviderEnum,
  type Session,
  type SessionHeader,
  type SessionMeta,
  type SessionSettings,
  type Settings,
} from '@shared/types'
import { SessionSettingsSchema } from '@shared/types/settings'
import dayjs from 'dayjs'
import { getDefaultStore } from 'jotai'
import { difference, intersection, uniq } from 'lodash'
import oldStore from 'store'
import { v5 as uuidv5 } from 'uuid'
import { sessionRepository } from '@/app/renderer-application'
import {
  artifactSessionCN,
  artifactSessionEN,
  defaultSessionsForCN,
  defaultSessionsForEN,
  imageCreatorSessionForCN,
  imageCreatorSessionForEN,
  mermaidSessionCN,
  mermaidSessionEN,
} from '@/packages/initial_data'
import platform from '@/platform'
import type { Storage } from '@/platform/interfaces'
import { getOldVersionStorages } from '@/platform/storages'
import WebPlatform from '@/platform/web_platform'
import { initData } from '@/setup/init_data'
import storage, { StorageKey } from '@/storage'
import { createSessionMetaRecordsFromLegacyList } from '@/utils/session-utils'
import * as defaults from '../../shared/defaults'
import { getLogger } from '../lib/utils'
import { migrationProcessAtom } from './atoms/utilAtoms'
import { withMigrationErrorContext } from './migration-error'
import { getSessionMeta } from './sessionHelpers'

const log = getLogger('migration')

export async function migrate() {
  await migrateStorage()
  await migrateOnData(
    {
      getData: storage.getItem.bind(storage),
      setData: storage.setItemNow.bind(storage),
      setAll: storage.setAll.bind(storage),
      getSessionHeader: (id) => sessionRepository.readUpgradeSessionHeader(id),
      importSession: (session) => sessionRepository.storeLegacyUpgradeInput(session),
      updateSessionSettings: (id, settings) => sessionRepository.upgradeLegacySessionSettings(id, settings),
      openMessages: openUpgradeMessages,
      setBlob: storage.setBlob.bind(storage),
    },
    true
  )
}

type MigrateStore = {
  getData: <T>(key: StorageKey | string, defaultValue: T) => Promise<T>
  setData: <T>(key: StorageKey | string, value: T) => Promise<void>
  setAll: (data: { [key: string]: unknown }) => Promise<void>
  getSessionHeader: (id: string) => Promise<SessionHeader | null>
  importSession: (source: Session) => Promise<void>
  updateSessionSettings: (id: string, settings: SessionSettings) => Promise<void>
  openMessages: (id: string) => Promise<UpgradeMessages>
  setBlob?: (key: string, value: string) => Promise<void>
}

export const CurrentVersion = 15

type UpgradeMessages = {
  messages: AsyncIterable<Message>
  read: (messageId: string) => Promise<Message | undefined>
}

async function openUpgradeMessages(sessionId: string): Promise<UpgradeMessages> {
  const read = await sessionRepository.getSessionHeader(sessionId)
  if (!read) throw new Error(`Missing conversation ${sessionId} during upgrade`)
  return {
    messages: (async function* () {
      let cursor: SessionTranscriptCursor | undefined
      do {
        const page = await sessionRepository.readSessionTranscriptWindow({
          sessionId,
          limit: 50,
          origin: { threadId: read.activeThreadId, edge: 'head' },
          expectedRevision: read.revision,
          cursor,
        })
        if (!page) throw new Error('Conversation disappeared during upgrade')
        for (const row of page.messages) {
          if (row.threadId !== read.activeThreadId) return
          yield row.message
        }
        cursor = page.newer ?? undefined
      } while (cursor)
    })(),
    read: async (messageId) =>
      (
        await sessionRepository.readSessionMessages({
          sessionId,
          messageIds: [messageId],
          expectedRevision: read.revision,
        })
      )?.messages[0],
  }
}

/** Legacy documents exist only inside the import parsing adapter. */
function legacyMigrationInput(input: LegacyBackupDataStore): MigrateStore {
  return {
    getData: (key, fallback) => input.getData(key, fallback),
    setData: (key, value) => input.setData(key, value),
    setAll: (values) => input.setAll(values),
    getSessionHeader: async (id) => {
      const source = await input.getSession(id)
      if (!source) return null
      const {
        messages: _messages,
        threads: _threads,
        messageForksHash: _forks,
        compactionPoints: _points,
        ...header
      } = source
      return header
    },
    importSession: (source) => input.setSession(source),
    updateSessionSettings: async (id, settings) => {
      const source = await input.getSession(id)
      if (!source) throw new Error(`Missing imported session ${id}`)
      await input.setSession({ ...source, settings })
    },
    async openMessages(id) {
      const source = await input.getSession(id)
      return {
        messages: (async function* () {
          if (source) yield* source.messages
        })(),
        read: async (messageId) => source?.messages.find((message) => message.id === messageId),
      }
    },
  }
}

async function doMigrateStorage(oldStorage: Storage) {
  // 找到老版本的数据，说明是升级，执行数据迁移操作
  log.info(
    `migrateStorage: old version storage found, migrating data from old storage(${oldStorage.getStorageType()}) to ${storage.getStorageType()}`
  )
  if (platform.type === 'mobile') {
    // for mobile copy all keys
    const keys = await oldStorage.getAllStoreKeys()
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]
      try {
        const val = await oldStorage.getStoreValue(key)
        await storage.setItemNow(key, val)
        log.info(`migrateStorage: ${index + 1} / ${keys.length} migrated`)
      } catch {
        log.info(`migrateStorage: failed to migrate ${key}`)
      }
    }
  } else if (platform.type === 'desktop') {
    // for desktop copy all except settings, configs and configVersion, then delete old key
    const kvs = await oldStorage.getAllStoreValues()
    const keys = Object.keys(kvs).filter((k) => !['settings', 'configs', 'configVersion'].includes(k))
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]
      try {
        const val = kvs[key]
        await storage.setItemNow(key, val)
        await oldStorage.delStoreValue(key)
        log.info(`migrateStorage: ${index + 1} / ${keys.length} migrated`)
      } catch {
        log.info(`migrateStorage: failed to migrate ${key}`)
      }
    }
  } else {
    // no migration for web platform yet
  }
  const migrated = await oldStorage.getStoreValue('migrated')

  await oldStorage.setStoreValue(
    'migrated',
    `${migrated ? `${migrated}\n` : ''}migrated from ${oldStorage.getStorageType()} to ${storage.getStorageType()} on ${dayjs().format('YYYY-MM-DD')}`
  )
}

async function findNewestStorage(oldStorages: Storage[]): Promise<[number, Storage | null]> {
  let configVersion = 0
  let newestStorage: Storage | null = null
  for (const oldStorage of oldStorages) {
    const version = await oldStorage.getStoreValue(StorageKey.ConfigVersion)
    if (version && version > configVersion) {
      configVersion = version
      newestStorage = oldStorage
    }
  }
  return [configVersion, newestStorage]
}
export const _migrateStorageForTest = migrateStorage

async function migrateStorage() {
  const configVersion = await storage.getItem<number>(StorageKey.ConfigVersion, 0)

  log.info(`migrateStorage: current storage config version: ${configVersion}`)

  if (configVersion >= CurrentVersion) {
    return
  }

  /**
   * 对于桌面端：
   *   需要判断configVersion，如果小于上次迁移过数据的版本号，需要从旧的storage中迁移数据
   * 对于其他端（目前只有移动端）：
   *   需要遍历所有旧的storage，找到configVersion最大的那个，如果比当前的新，则迁移数据
   * 如果当前 configVersion 为 0，且没有找到可迁移数据，说明是第一次启动应用，需要初始化数据
   */

  let needMigration = false

  const latestDesktopMigratedVersion = 12 // desktop 端最新的迁移版本是 11 到 12

  // 桌面端的configVersion一直在config file storage中，不存在不同storage间不同的情况
  if (platform.type === 'desktop' && configVersion > 0 && configVersion < latestDesktopMigratedVersion) {
    log.info(
      `migrateStorage: desktop platform needs migration, config version ${configVersion} < latest migrated version ${latestDesktopMigratedVersion}`
    )
    needMigration = true
  }

  const [oldConfigVersion, oldStorage] = await findNewestStorage(getOldVersionStorages())

  if (!needMigration) {
    log.info(
      `migrateStorage check: platform ${platform.type} old config version: ${oldConfigVersion}, old storage: ${oldStorage?.getStorageType()}`
    )

    if (
      platform.type !== 'desktop' &&
      oldConfigVersion > configVersion &&
      oldStorage &&
      oldStorage.getStorageType() !== storage.getStorageType()
    ) {
      needMigration = true
    }
  }

  if (needMigration && oldStorage) {
    await doMigrateStorage(oldStorage)
  }

  if (configVersion === 0 && needMigration === false) {
    log.info(`migrateStorage: no old storage found, and config version is 0, initializing data`)
    // 这是第一次运行应用，直接将ConfigVersion设置为CurrentVersion，跳过后续的数据迁移
    await storage.setItemNow(StorageKey.ConfigVersion, CurrentVersion)
    // 初始化默认会话
    await initData()
  }
}

export async function migrateOnData(input: MigrateStore | LegacyBackupDataStore, canRelaunch = true) {
  const dataStore = 'getSession' in input ? legacyMigrationInput(input) : input
  let needRelaunch = false
  let configVersion = await dataStore.getData(StorageKey.ConfigVersion, 0)

  if (configVersion >= CurrentVersion) {
    return
  }

  log.info(`migrateOnData: ${configVersion}, canRelaunch: ${canRelaunch}`)

  const migrateFunctions = [
    null,
    null,
    migrate_2_to_3,
    null,
    null,
    null,
    null,
    migrate_7_to_8,
    null,
    migrate_9_to_10,
    migrate_10_to_11,
    migrate_11_to_12,
    migrate_12_to_13,
    migrate_13_to_14,
    migrate_14_to_15,
  ]

  for (; configVersion < CurrentVersion; configVersion++) {
    const _needRelaunch = await withMigrationErrorContext(
      { configVersion, targetConfigVersion: configVersion + 1 },
      async () => {
        const result = await migrateFunctions[configVersion]?.(dataStore)
        await dataStore.setData(StorageKey.ConfigVersion, configVersion + 1)
        return result
      }
    )
    needRelaunch ||= !!_needRelaunch
    log.info(`migrate_${configVersion}_to_${configVersion + 1}, needRelaunch: ${needRelaunch}`)
  }

  // 如果需要重启，则重启应用
  if (needRelaunch && canRelaunch) {
    log.info(`migrate: relaunch`)
    await platform.relaunch()
  }
}

async function migrate_0_to_1(dataStore: MigrateStore) {
  const settings = await dataStore.getData(StorageKey.Settings, defaults.settings())
  // 如果历史版本的用户开启了消息的token计数展示，那么也帮他们开启token消耗展示
  if (settings.showTokenCount) {
    await dataStore.setData(StorageKey.Settings, {
      ...settings,
      showTokenUsed: true,
    })
  }
}

async function migrate_1_to_2(dataStore: MigrateStore) {
  const sessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  const lang = await platform.getLocale()
  if (lang.startsWith('zh')) {
    if (sessions.find((session) => session.id === imageCreatorSessionForCN.id)) {
      return
    }
    await dataStore.setData(StorageKey.ChatSessions, [...sessions, imageCreatorSessionForCN])
  } else {
    if (sessions.find((session) => session.id === imageCreatorSessionForEN.id)) {
      return
    }
    await dataStore.setData(StorageKey.ChatSessions, [...sessions, imageCreatorSessionForEN])
  }
}

async function migrate_2_to_3(dataStore: MigrateStore) {
  // 原来 Electron 应用存储图片 base64 数据到 IndexedDB，现在改成本地文件存储
  if (!dataStore.setBlob) {
    return
  }
  if (platform.type !== 'desktop') {
    return
  }
  const ws = new WebPlatform()
  const blobKeys = await ws.listStoreBlobKeys()
  for (const key of blobKeys) {
    const value = await ws.getStoreBlob(key)
    if (!value) {
      continue
    }
    await dataStore.setBlob(key, value)
    await ws.delStoreBlob(key)
  }
}

async function migrate_3_to_4(dataStore: MigrateStore) {
  const sessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  const lang = await platform.getLocale()
  const targetSession = lang.startsWith('zh') ? artifactSessionCN : artifactSessionEN
  if (sessions.find((session) => session.id === targetSession.id)) {
    return
  }
  await dataStore.setData(StorageKey.ChatSessions, [...sessions, targetSession])
}

// 已经迁移到storage migration
async function migrate_4_to_5(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'web') {
    return false
  }
  // 针对网页版，从 store 迁移至 localforage
  // 本质上是从更小的 localStorage 迁移到更大的 IndexedDB，解决容量不够用的问题
  const keys: string[] = []
  oldStore.each((value, key) => {
    keys.push(key)
  })
  if (keys.length === 0) {
    return false
  }
  for (const key of keys) {
    await dataStore.setData(key, oldStore.get(key))
  }
  return true
}

async function migrate_5_to_6(dataStore: MigrateStore) {
  const sessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  const lang = await platform.getLocale()
  const targetSession = lang.startsWith('zh') ? mermaidSessionCN : mermaidSessionEN
  if (sessions.find((session) => session.id === targetSession.id)) {
    return
  }
  await dataStore.setData(StorageKey.ChatSessions, [...sessions, targetSession])
}

// 针对 mobile 端，从 store 迁移至 sqlite
// 解决容量不够用的问题
// 不在需要了
async function migrate_6_to_7(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'mobile') {
    return false
  }
  // 针对mobile端，从 store 迁移至 sqllite
  // 解决容量不够用的问题
  const keys: string[] = []
  oldStore.each((value, key) => {
    keys.push(key)
  })
  if (keys.length === 0) {
    return false
  }
  for (const key of keys) {
    await dataStore.setData(key, oldStore.get(key))
  }
  return true
}

// 从所有 sessions 保存在一个 key 迁移到每个 session 保存在一个 key，增加 session 列表的读取性能
async function migrate_7_to_8(dataStore: MigrateStore): Promise<boolean> {
  const sessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  log.info(`migrate_7_to_8, sessions: ${sessions.length}`)
  if (sessions.length === 0) {
    return false
  }

  const sessionList = sessions.map((session) => getSessionMeta(session))
  await dataStore.setData(StorageKey.ChatSessionsList, sessionList)
  log.info(`migrate_7_to_8, sessionList: ${sessionList.length}`)

  for (const session of sessions) {
    await dataStore.importSession(session)
  }
  log.info(`migrate_7_to_8, done`)
  return true
}

// 修复之前从 7 以下升级，会导致 7_8 不执行的问题，从 chat-sessions 里找到 chat-sessions-list 中不存在的 session，然后迁移
async function migrate_8_to_9(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'mobile') {
    return false
  }

  const oldSessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  log.info(`migrate_8_to_9, old sessions: ${oldSessions.length}`)
  if (oldSessions.length === 0) {
    return false
  }

  const sessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  const existedSessionIds = sessionList.map((session) => session.id)

  // 如果 排除掉 预置的 session， chat-sessions 和 chat-sessions-list 里的 session id 全都不一致，说明之前漏了 7-8 的 migration，需要执行数据找回，否则跳过找回步骤
  const intersectSessionIds = intersection(
    existedSessionIds,
    oldSessions.map((session) => session.id)
  )

  const defaultSessionIds = uniq([
    ...defaultSessionsForEN.map((session) => session.id),
    ...defaultSessionsForCN.map((session) => session.id),
  ])

  // 如果 intersectSessionIds 里还有值，说明之前成功执行过 7-8 的 migration，跳过找回步骤
  if (difference(intersectSessionIds, defaultSessionIds).length !== 0) {
    return false
  }

  // 找到 chat-sessions 里不存在于 chat-sessions-list 的 session
  const missedSessions = oldSessions.filter((session) => !existedSessionIds.includes(session.id))
  const missedSessionList = missedSessions.map((session) => getSessionMeta(session))
  log.info(`migrate_8_to_9, missedSessions: ${missedSessions.length}`)

  // 写入 chat-sessions-list
  await dataStore.setData(StorageKey.ChatSessionsList, [...sessionList, ...missedSessionList])
  for (const session of missedSessions) {
    await dataStore.importSession(session)
  }
  log.info(`migrate_8_to_9 done`)

  return true
}

function setInitProcess(process: string) {
  const store = getDefaultStore()
  store.set(migrationProcessAtom, process)
}

// 迁移provider settings，session settings
async function migrate_9_to_10(dataStore: MigrateStore): Promise<boolean> {
  const oldSettings = await dataStore.getData<LegacyFlatSettings | null>(StorageKey.Settings, null)
  if (oldSettings) {
    // 迁移provider相关的配置（纯数据变换已下沉到 shared，web/native 共用）
    const { providers, customProviders } = migrateLegacyProviderSettings(oldSettings)

    try {
      await dataStore.setData(StorageKey.Settings, {
        ...oldSettings,
        providers,
        customProviders,
      } as Settings)
      log.info('migrate settings done')
    } catch (e) {
      log.info('save new settings to store failed.')
      throw e
    }
  }

  // 迁移session settings
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_9_to_10, chatSessionList: ${chatSessionList.length}`)

  for (let i = 0; i < chatSessionList.length; i++) {
    const sessionMeta = chatSessionList[i]
    try {
      const session = await dataStore.getSessionHeader(sessionMeta.id)

      if (session?.id) {
        const oldSessionSettings: LegacyFlatSettings = session.settings || {}
        if (typeof oldSessionSettings.provider === 'string') continue
        const sessionProvider = oldSessionSettings.aiProvider ?? oldSettings?.aiProvider ?? ModelProviderEnum.ChatboxAI
        const modelKey = LEGACY_PROVIDER_MODEL_KEYS[sessionProvider]
        const modelId = modelKey ? (oldSessionSettings[modelKey] ?? oldSettings?.[modelKey]) : undefined
        const settings = SessionSettingsSchema.parse(
          session.type === 'chat'
            ? {
                provider: sessionProvider,
                modelId,
                maxContextMessageCount:
                  oldSessionSettings.maxContextMessageCount ?? oldSettings?.maxContextMessageCount,
                temperature: oldSessionSettings.temperature ?? oldSettings?.temperature,
                topP: oldSessionSettings.topP ?? oldSettings?.topP,
              }
            : {
                provider: new Set<string>([
                  ModelProviderEnum.ChatboxAI,
                  ModelProviderEnum.OpenAI,
                  ModelProviderEnum.Azure,
                ]).has(oldSettings?.aiProvider ?? '')
                  ? oldSettings?.aiProvider
                  : ModelProviderEnum.ChatboxAI,
                modelId: 'DALL-E-3',
                imageGenerateNum: oldSessionSettings.imageGenerateNum ?? 3,
                dalleStyle: oldSessionSettings.dalleStyle ?? 'vivid',
              }
        )

        await dataStore.updateSessionSettings(session.id, settings)
      }
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings done`)
    } catch (e) {
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings failed, ${sessionMeta.name}`)
      throw e
    }
  }

  log.info(`migrate_9_to_10, done`)
  return true
}

async function migrate_10_to_11(dataStore: MigrateStore) {
  if (platform.type === 'mobile') {
    // 释放 localstorage 空间
    log.info('migrate_10_to_11, remove settings')
    oldStore.remove(StorageKey.Settings)
  }

  // 修复之前写入的错误的默认值
  const settings = await dataStore.getData<Settings | null>(StorageKey.Settings, null)
  if (settings) {
    if (settings.fontSize === 16) {
      settings.fontSize = 14
    }
    await dataStore.setData(StorageKey.Settings, settings)
  }
  log.info('migrate_10_to_11, done')
  return false
}

// 为桌面端和移动端从sqlite和配置文件迁移到IndexedDB占位，防止后面重复使用该版本号
async function migrate_11_to_12(dataStore: MigrateStore) {
  return true
}

// 为移动端从indexedDB迁移到Sqlite占位，防止后面重复使用该版本号
async function migrate_12_to_13(dataStore: MigrateStore) {
  return true
}

async function migrate_13_to_14(dataStore: MigrateStore) {
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_13_to_14, total sessions: ${chatSessionList.length}`)

  const pictureSessions = chatSessionList.filter((s) => s.type === 'picture')
  log.info(`migrate_13_to_14, picture sessions: ${pictureSessions.length}`)

  if (pictureSessions.length === 0) {
    return false
  }

  const imageGenerationStorage = platform.getImageGenerationStorage()
  await imageGenerationStorage.initialize()

  let migratedCount = 0

  for (const sessionMeta of pictureSessions) {
    try {
      const session = await dataStore.getSessionHeader(sessionMeta.id)
      if (!session) throw new Error(`Missing picture conversation ${sessionMeta.id}`)
      const source = await dataStore.openMessages(session.id)

      let parentId: string | undefined
      const pendingUserIds: string[] = []
      for await (const assistantMsg of source.messages) {
        if (assistantMsg.role === 'user') {
          pendingUserIds.push(assistantMsg.id)
          continue
        }
        if (assistantMsg.role !== 'assistant') continue
        for (const messageId of pendingUserIds) {
          const msg = await source.read(messageId)
          if (!msg) throw new Error(`Picture message ${messageId} disappeared during upgrade`)
          const prompt = msg.contentParts?.find((p) => p.type === 'text')?.text || ''
          if (!prompt) continue

          const referenceImages = (msg.contentParts || [])
            .filter(
              (p): p is { type: 'image'; storageKey: string } =>
                p.type === 'image' && !!p.storageKey && p.storageKey.length > 0
            )
            .map((p) => p.storageKey)

          const generatedImages = (assistantMsg.contentParts || [])
            .filter(
              (p): p is { type: 'image'; storageKey: string } =>
                p.type === 'image' && !!p.storageKey && p.storageKey.length > 0
            )
            .map((p) => p.storageKey)

          if (generatedImages.length === 0) continue

          const recordId = uuidv5(JSON.stringify(['picture-upgrade', session.id, msg.id]), uuidv5.URL)
          const existing = await imageGenerationStorage.getById(recordId)
          const record: ImageGeneration = {
            id: recordId,
            prompt,
            referenceImages,
            generatedImages,
            createdAt: assistantMsg.timestamp || existing?.createdAt || Date.now(),
            model: {
              provider: session.settings?.provider || ModelProviderEnum.ChatboxAI,
              modelId: session.settings?.modelId || 'DALL-E-3',
            },
            dalleStyle: session.settings?.dalleStyle,
            imageGenerateNum: session.settings?.imageGenerateNum,
            status: 'done',
            parentIds: parentId ? [parentId] : undefined,
          }

          if (existing) await imageGenerationStorage.update(recordId, record)
          else await imageGenerationStorage.create(record)
          migratedCount++
          parentId = recordId
        }
        pendingUserIds.length = 0
      }
    } catch (e) {
      log.info(`migrate_13_to_14, failed to migrate session: ${sessionMeta.id}`, e)
      throw e
    }
  }

  log.info(`migrate_13_to_14, migrated ${migratedCount} image generation records`)
  return false
}

async function migrate_14_to_15(dataStore: MigrateStore) {
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_14_to_15, total sessions: ${chatSessionList.length}`)

  if (chatSessionList.length === 0) {
    return false
  }

  const sessionMetaStorage = platform.getSessionMetaStorage()
  await sessionMetaStorage.initialize()

  const records = createSessionMetaRecordsFromLegacyList(chatSessionList)

  await sessionMetaStorage.createMany(records)

  log.info(`migrate_14_to_15, migrated ${records.length} session meta records to DB`)
  return false
}
