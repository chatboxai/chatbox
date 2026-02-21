import { createStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'

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
      version: 1,
      migrate: (persistedState, version) => {
        const persisted = (persistedState as State | undefined) || {}
        if (!persisted || version >= 1) {
          return persisted
        }

        const next = { ...persisted }
        if (next.chat?.provider === 'chatbox-ai') {
          next.chat = { provider: 'openai', modelId: 'gpt-4o' }
        }
        if (next.picture?.provider === 'chatbox-ai') {
          next.picture = { provider: 'openai', modelId: 'gpt-image-1' }
        }
        return next
      },
      skipHydration: true,
      storage: safeStorage,
    }
  )
)

let initLastUsedModelStorePromise: Promise<State> | undefined
export const initLastUsedModelStore = () => {
  if (!initLastUsedModelStorePromise) {
    initLastUsedModelStorePromise = new Promise<State>((resolve) => {
      const unsub = lastUsedModelStore.persist.onFinishHydration((val) => {
        unsub()
        resolve(val)
      })
      lastUsedModelStore.persist.rehydrate()
    })
  }
  return initLastUsedModelStorePromise
}
