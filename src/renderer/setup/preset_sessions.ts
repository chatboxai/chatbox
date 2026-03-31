import type { Session, SessionMeta } from '@shared/types'
import {
  defaultPresetSessionBundlesForCN,
  defaultPresetSessionBundlesForEN,
  type PresetSessionBundle,
} from '@/packages/initial_data'
import { StorageKey, StorageKeyGenerator } from '@/storage/StoreStorage'
import { getSessionMeta } from '@/stores/sessionHelpers'

type PresetSessionStore = {
  getData: <T>(key: string, defaultValue: T) => Promise<T>
  setData: <T>(key: string, value: T) => Promise<void>
  setBlob: (key: string, value: string) => Promise<void>
}

export function getPresetSessionsForLocale(locale: string): Session[] {
  return getPresetSessionBundlesForLocale(locale).map(({ session }) => session)
}

export function getPresetSessionBundlesForLocale(locale: string): PresetSessionBundle[] {
  return locale.startsWith('zh') ? defaultPresetSessionBundlesForCN : defaultPresetSessionBundlesForEN
}

async function seedPresetSessionBlobs(store: PresetSessionStore, presetSessionBundle: PresetSessionBundle) {
  for (const blobEntry of presetSessionBundle.blobEntries || []) {
    await store.setBlob(blobEntry.key, blobEntry.value)
  }
}

export async function backfillPresetSessions(
  store: PresetSessionStore,
  locale: string,
  existingSessionList?: SessionMeta[]
): Promise<SessionMeta[]> {
  const presetSessionBundles = getPresetSessionBundlesForLocale(locale)
  const currentSessionList = existingSessionList ?? (await store.getData<SessionMeta[]>(StorageKey.ChatSessionsList, []))
  const sessionMetaById = new Map(currentSessionList.map((sessionMeta) => [sessionMeta.id, sessionMeta]))
  const nextSessionList = [...currentSessionList]
  let changed = false

  for (const presetSessionBundle of presetSessionBundles) {
    const presetSession = presetSessionBundle.session

    await seedPresetSessionBlobs(store, presetSessionBundle)

    if (sessionMetaById.has(presetSession.id)) {
      continue
    }

    const sessionStorageKey = StorageKeyGenerator.session(presetSession.id)
    const existingSession = await store.getData<Session | null>(sessionStorageKey, null)

    if (existingSession) {
      nextSessionList.push(getSessionMeta(existingSession))
    } else {
      await store.setData(sessionStorageKey, presetSession)
      nextSessionList.push(getSessionMeta(presetSession))
    }

    sessionMetaById.set(presetSession.id, nextSessionList[nextSessionList.length - 1])
    changed = true
  }

  if (changed) {
    await store.setData(StorageKey.ChatSessionsList, nextSessionList)
  }

  return nextSessionList
}
