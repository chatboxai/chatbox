import { getBestEffortFileNativePath } from '@/utils/file-native-path'

const FILE_UNIQ_KEY_PROPERTY = '__chatboxFileUniqKey'

type FileWithRememberedUniqKey = File & {
  [FILE_UNIQ_KEY_PROPERTY]?: string
}

/**
 * Historical attachment cache-key algorithm, isolated from StoreStorage so a
 * file-picker adapter does not initialize the complete Renderer storage graph.
 */
export function getFileUniqKey(file: File): string {
  const fileWithRememberedUniqKey = file as FileWithRememberedUniqKey
  if (fileWithRememberedUniqKey[FILE_UNIQ_KEY_PROPERTY]) {
    return fileWithRememberedUniqKey[FILE_UNIQ_KEY_PROPERTY]
  }

  const uniqKey = `file:${getBestEffortFileNativePath(file) || file.name}-${file.size}-${file.lastModified}`
  Object.defineProperty(file, FILE_UNIQ_KEY_PROPERTY, {
    value: uniqKey,
    configurable: true,
  })
  return uniqKey
}
