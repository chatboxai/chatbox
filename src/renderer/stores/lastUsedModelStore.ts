import { createStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'
import { getLogger } from '@/lib/utils'

const log = getLogger('last-used-model-store')
const LAST_USED_MODEL_HYDRATION_TIMEOUT_MS = 8000

type State = {
  chat?: {
    provider: string
    modelId: string
  }
  picture?: {
    provider: string
    modelId: string
  }
}

export const lastUsedModelStore = createStore(
  persist(
    combine(
      {
        chat: undefined,
        picture: undefined,
      } as State,
      (set) => ({
        setChatModel: (provider: string, modelId: string) => {
          set({
            chat: {
              provider,
              modelId,
            },
          })
        },
        setPictureModel: (provider: string, modelId: string) => {
          set({
            picture: {
              provider,
              modelId,
            },
          })
        },
      })
    ),
    {
      name: 'last-used-model',
      version: 0,
      skipHydration: true,
      storage: safeStorage,
    }
  )
)

let initLastUsedModelStorePromise: Promise<State> | undefined
export const initLastUsedModelStore = async () => {
  if (!initLastUsedModelStorePromise) {
    initLastUsedModelStorePromise = new Promise<State>((resolve) => {
      let settled = false
      const resolveOnce = (val: State) => {
        if (settled) {
          return
        }
        settled = true
        resolve(val)
      }

      const unsub = lastUsedModelStore.persist.onFinishHydration((val) => {
        unsub()
        clearTimeout(timeoutId)
        resolveOnce(val)
      })

      const timeoutId = setTimeout(() => {
        unsub()
        log.error(
          `last-used-model hydration timeout after ${LAST_USED_MODEL_HYDRATION_TIMEOUT_MS}ms, fallback to current state`
        )
        const state = lastUsedModelStore.getState()
        resolveOnce({ chat: state.chat, picture: state.picture })
      }, LAST_USED_MODEL_HYDRATION_TIMEOUT_MS)

      Promise.resolve(lastUsedModelStore.persist.rehydrate()).catch((e) => {
        unsub()
        clearTimeout(timeoutId)
        log.error('last-used-model rehydrate failed, fallback to current state', e)
        const state = lastUsedModelStore.getState()
        resolveOnce({ chat: state.chat, picture: state.picture })
      })
    })
  }
  return initLastUsedModelStorePromise
}
