import { v4 as uuidv4 } from 'uuid'
import type { Platform } from '../../../src/renderer/platform/interfaces'
import { createAfetch } from '../../../src/shared/request/request'
import type { ModelDependencies } from '../../../src/shared/types/adapters'
import { createNoopLangSmithAdapter } from '../../../src/shared/utils/langsmith_adapter'
import type { SentryAdapter } from '../../../src/shared/utils/sentry_adapter'

export async function createMockModelDependencies(
  platform: Platform,
  sentry: SentryAdapter
): Promise<ModelDependencies> {
  const platformInfo = {
    type: platform.type,
    platform: await platform.getPlatform(),
    os: 'test',
    version: await platform.getVersion(),
  }

  const afetch = createAfetch(platformInfo)
  const testPlatform = platform
  const testSentry = sentry

  return {
    storage: {
      async saveImage(folder: string, dataUrl: string): Promise<string> {
        const storageKey = `picture:${folder}:${uuidv4()}`
        await testPlatform.setStoreBlob(storageKey, dataUrl)
        return storageKey
      },
      async getImage(storageKey: string): Promise<string> {
        const blob = await testPlatform.getStoreBlob(storageKey)
        return blob || ''
      },
    },
    request: {
      fetchWithOptions: async (
        url: string,
        init?: RequestInit,
        options?: { retry?: number; parseChatboxRemoteError?: boolean }
      ): Promise<Response> => {
        return afetch(url, init, options || {})
      },
      async apiRequest(options): Promise<Response> {
        const init: RequestInit = {
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body,
          signal: options.signal,
        }
        return afetch(options.url, init, { retry: options.retry })
      },
    },
    sentry: testSentry,
    langsmith: createNoopLangSmithAdapter(),
    getRemoteConfig: () => ({}),
  }
}
