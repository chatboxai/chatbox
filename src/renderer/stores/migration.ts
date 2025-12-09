import * as Sentry from '@sentry/react'
import dayjs from 'dayjs'
import { getDefaultStore } from 'jotai'
import { difference, intersection, keyBy, uniq, uniqBy } from 'lodash'
import oldStore from 'store'
import { v4 as uuidv4 } from 'uuid'
import {
  type ModelProvider,
  ModelProviderEnum,
  ModelProviderType,
  type Session,
  type SessionMeta,
  type Settings,
} from '@/../shared/types'
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
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as defaults from '../../shared/defaults'
import { getLogger } from '../lib/utils'
import { migrationProcessAtom } from './atoms/utilAtoms'
import { getSessionMeta } from './sessionHelpers'

const log = getLogger('migration')

export async function migrate() {
  await migrateStorage()
  await migrateOnData(
    {
      getData: storage.getItem.bind(storage),
      setData: storage.setItemNow.bind(storage),
      setAll: storage.setAll.bind(storage),
      setBlob: storage.setBlob.bind(storage),
    },
    true
  )
}

type MigrateStore = {
  getData: <T>(key: StorageKey, defaultValue: T) => Promise<T>
  setData: <T>(key: StorageKey | string, value: T) => Promise<void>
  setAll: (data: { [key: string]: unknown }) => Promise<void>
  setBlob?: (key: string, value: string) => Promise<void>
}

export const CurrentVersion = 13

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

export async function migrateOnData(dataStore: MigrateStore, canRelaunch = true) {
  let needRelaunch = false
  let configVersion = await dataStore.getData(StorageKey.ConfigVersion, 0)

  if (configVersion >= CurrentVersion) {
    return
  }

  const scope = Sentry.getCurrentScope()
  scope.setTag('configVersion', configVersion)
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
  ]

  for (; configVersion < CurrentVersion; configVersion++) {
    const _needRelaunch = await migrateFunctions[configVersion]?.(dataStore)
    needRelaunch ||= !!_needRelaunch
    await dataStore.setData(StorageKey.ConfigVersion, configVersion + 1)
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

  // 一次写入所有 session， 提升性能
  const sessionMap = keyBy(sessions, (session) => StorageKeyGenerator.session(session.id))
  await dataStore.setAll(sessionMap)
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
  const missedSessionMap = keyBy(missedSessions, (session) => StorageKeyGenerator.session(session.id))
  await dataStore.setAll(missedSessionMap)
  log.info(`migrate_8_to_9 done`)

  return true
}

function setInitProcess(process: string) {
  const store = getDefaultStore()
  store.set(migrationProcessAtom, process)
}

// 迁移provider settings，session settings
async function migrate_9_to_10(dataStore: MigrateStore): Promise<boolean> {
  const oldSettings = (await dataStore.getData(StorageKey.Settings, null)) as any
  if (oldSettings) {
    const {
      aiProvider,
      // openai
      openaiKey,
      apiHost,
      model,
      openaiCustomModel, // OpenAI 自定义模型的 ID
      openaiCustomModelOptions,
      openaiUseProxy, // deprecated

      dalleStyle,
      imageGenerateNum,

      // azure
      azureEndpoint,
      azureDeploymentName,
      azureDeploymentNameOptions,
      azureDalleDeploymentName, // dall-e-3 的部署名称
      azureApikey,
      azureApiVersion,

      // chatglm
      chatglm6bUrl, // deprecated
      chatglmApiKey,
      chatglmModel,

      // chatbox-ai
      chatboxAIModel,

      // claude
      claudeApiKey,
      claudeApiHost,
      claudeModel,

      // google gemini
      geminiAPIKey,
      geminiAPIHost,
      geminiModel,

      // ollama
      ollamaHost,
      ollamaModel,

      // groq
      groqAPIKey,
      groqModel,

      // deepseek
      deepseekAPIKey,
      deepseekModel,

      // siliconflow
      siliconCloudKey,
      siliconCloudModel,

      // LMStudio
      lmStudioHost,
      lmStudioModel,

      // perplexity
      perplexityApiKey,
      perplexityModel,

      // xai
      xAIKey,
      xAIModel,

      // modelscope
      modelscopeApiKey,
      modelscopeModel,

      // custom provider
      selectedCustomProviderId, // 选中的自定义提供者 ID，仅当 aiProvider 为 custom 时有效
      customProviders: oldCustomProviders,

      temperature, // 0-2
      topP, // 0-1
      openaiMaxContextMessageCount, // 聊天消息上下文的消息数量限制。超过20表示不限制
      maxContextMessageCount,
    } = oldSettings

    // 迁移provider相关的配置
    const providers: Settings['providers'] = {}
    const customProviders: Settings['customProviders'] = []

    try {
      if (openaiKey || apiHost) {
        providers[ModelProviderEnum.OpenAI] = {
          apiHost,
          apiKey: openaiKey,
          // 将openaiCustomModelOptions和openaiCustomModel迁移过来
          models:
            openaiCustomModel || openaiCustomModelOptions
              ? uniqBy(
                  [
                    ...(defaults.SystemProviders.find((p) => p.id === ModelProviderEnum.OpenAI)?.defaultSettings
                      ?.models || []),
                    ...(openaiCustomModel ? [{ modelId: openaiCustomModel }] : []),
                    ...(openaiCustomModelOptions || []).map((o: string) => ({
                      modelId: o,
                    })),
                  ],
                  'modelId'
                )
              : undefined,
        }
      }
      log.info('migrate openai settings done')
    } catch (e) {
      log.info('migrate openai settings failed.')
    }

    if (claudeApiKey || claudeApiHost) {
      providers[ModelProviderEnum.Claude] = {
        apiKey: claudeApiKey,
        apiHost: claudeApiHost,
      }
      log.info('migrate claude settings done')
    }
    if (geminiAPIKey || geminiAPIHost) {
      providers[ModelProviderEnum.Gemini] = {
        apiKey: geminiAPIKey,
        apiHost: geminiAPIHost,
      }
      log.info('migrate gemini settings done')
    }
    if (deepseekAPIKey) {
      providers[ModelProviderEnum.DeepSeek] = {
        apiKey: deepseekAPIKey,
      }
      log.info('migrate deepseek settings done')
    }
    if (siliconCloudKey) {
      providers[ModelProviderEnum.SiliconFlow] = {
        apiKey: siliconCloudKey,
      }
      log.info('migrate siliconflow settings done')
    }
    if (azureEndpoint || azureDeploymentNameOptions || azureDalleDeploymentName || azureApikey || azureApiVersion) {
      providers[ModelProviderEnum.Azure] = {
        apiKey: azureApikey,
        endpoint: azureEndpoint,
        dalleDeploymentName: azureDalleDeploymentName,
        apiVersion: azureApiVersion,
        models: azureDeploymentNameOptions?.map((op: string) => ({
          modelId: op,
        })),
      }
      log.info('migrate azure settings done')
    }
    if (xAIKey) {
      providers[ModelProviderEnum.XAI] = {
        apiKey: xAIKey,
      }
      log.info('migrate xai settings done')
    }
    if (ollamaHost) {
      providers[ModelProviderEnum.Ollama] = {
        apiHost: ollamaHost,
      }
      log.info('migrate ollama settings done')
    }
    if (lmStudioHost) {
      providers[ModelProviderEnum.LMStudio] = {
        apiHost: lmStudioHost,
      }
      log.info('migrate lmstudio settings done')
    }
    if (perplexityApiKey) {
      providers[ModelProviderEnum.Perplexity] = {
        apiKey: perplexityApiKey,
      }
      log.info('migrate perplexity settings done')
    }
    if (groqAPIKey) {
      providers[ModelProviderEnum.Groq] = {
        apiKey: groqAPIKey,
      }
      log.info('migrate groq settings done')
    }
    if (chatglmApiKey) {
      providers[ModelProviderEnum.ChatGLM6B] = {
        apiKey: chatglmApiKey,
      }
      log.info('migrate chatglm settings done')
    }
    if (modelscopeApiKey) {
      providers[ModelProviderEnum.ModelScope] = {
        apiKey: modelscopeApiKey,
      }
      log.info('migrate modelscope settings done')
    }

    try {
      if (oldCustomProviders) {
        oldCustomProviders.forEach((cp: any) => {
          const pid = 'custom-provider-' + uuidv4()
          customProviders.push({
            id: pid,
            name: cp.name,
            isCustom: true,
            type: ModelProviderType.OpenAI,
          })
          providers[pid] = {
            apiKey: cp.key,
            apiHost: cp.host,
            apiPath: cp.path,
            useProxy: cp.useProxy,
            models: uniq([...(cp.modelOptions || []), cp.model || ''])
              .filter((op) => !!op)
              .map((op: any) => ({
                modelId: op,
              })),
          }
          log.info(`migrate custom provider [${cp.name}] settings done`)
        })
      }
    } catch (e) {
      log.info('migrate custom provider settings failed.')
    }

    try {
      await dataStore.setData(StorageKey.Settings, {
        ...oldSettings,
        providers,
        customProviders,
      } as Settings)
      log.info('migrate settings done')
    } catch (e) {
      log.info('save new settings to store failed.')
    }
  }

  // 迁移session settings
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_9_to_10, chatSessionList: ${chatSessionList.length}`)

  const sessionMap: { [key: string]: Session } = {}
  for (let i = 0; i < chatSessionList.length; i++) {
    const sessionMeta = chatSessionList[i]
    try {
      const session: Session = await dataStore.getData(StorageKeyGenerator.session(sessionMeta.id) as any, {} as any)

      if (session.id) {
        const oldSessionSettings = (session.settings || {}) as any
        const sessionProvider: ModelProvider = oldSessionSettings.aiProvider ?? oldSettings.aiProvider
        const modelKey = {
          [ModelProviderEnum.ChatboxAI]: 'chatboxAIModel',
          [ModelProviderEnum.OpenAI]: 'model',
          [ModelProviderEnum.Claude]: 'claudeModel',
          [ModelProviderEnum.Gemini]: 'geminiModel',
          [ModelProviderEnum.Ollama]: 'ollamaModel',
          [ModelProviderEnum.LMStudio]: 'lmStudioModel',
          [ModelProviderEnum.DeepSeek]: 'deepseekModel',
          [ModelProviderEnum.SiliconFlow]: 'siliconCloudModel',
          [ModelProviderEnum.Azure]: 'azureDeploymentName',
          [ModelProviderEnum.XAI]: 'xAIModel',
          [ModelProviderEnum.Perplexity]: 'perplexityModel',
          [ModelProviderEnum.Groq]: 'groqModel',
          [ModelProviderEnum.ChatGLM6B]: 'chatglmModel',
          [ModelProviderEnum.ModelScope]: 'modelscopeModel',
          [ModelProviderEnum.Custom]: 'model',
        }[sessionProvider]
        const modelId: string = oldSessionSettings[modelKey!] ?? oldSettings[modelKey!]
        session.settings =
          session.type === 'chat'
            ? {
                provider: sessionProvider,
                modelId,
                maxContextMessageCount: oldSessionSettings.maxContextMessageCount ?? oldSettings.maxContextMessageCount,
                temperature: oldSessionSettings.temperature ?? oldSettings.temperature,
                topP: oldSessionSettings.topP ?? oldSettings.topP,
              }
            : {
                provider: [ModelProviderEnum.ChatboxAI, ModelProviderEnum.OpenAI, ModelProviderEnum.Azure].includes(
                  oldSettings.aiProvider
                )
                  ? oldSettings.aiProvider
                  : ModelProviderEnum.ChatboxAI,
                modelId: 'DALL-E-3',
                imageGenerateNum: oldSessionSettings.imageGenerateNum ?? 3,
                dalleStyle: oldSessionSettings.dalleStyle ?? 'vivid',
              }

        sessionMap[StorageKeyGenerator.session(session.id)] = session
      }
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings done`)
    } catch (e) {
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings failed, ${sessionMeta.name}`)
    }
  }

  try {
    await dataStore.setAll(sessionMap)
    log.info('migrate sessions settings done')
  } catch (e) {
    log.info('save sessions settings to store failed.')
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
