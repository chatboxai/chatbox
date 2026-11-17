import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'

export async function saveImage(category: string, picBase64: string) {
  const storageKey = StorageKeyGenerator.picture(category)
  // 图片需要存储到 indexedDB，如果直接使用 OpenAI 返回的图片链接，图片链接将随着时间而失效
  await currentBlobStorage.set(storageKey, picBase64)
  return storageKey
}
