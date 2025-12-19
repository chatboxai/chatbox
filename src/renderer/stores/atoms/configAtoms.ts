import { atomWithStorage } from 'jotai/utils'
import storage, { StorageKey } from '../../storage'

// configVersion 配置版本，用于判断是否需要升级迁移配置（migration）
// export const configVersionAtom = atomWithStorage<number>(StorageKey.ConfigVersion, 0, storage) // Keep commented out if original was

// 远程配置
export const remoteConfigAtom = atomWithStorage<{ setting_chatboxai_first?: boolean }>(
  StorageKey.RemoteConfig,
  {},
  storage
)
