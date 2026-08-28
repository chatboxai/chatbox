import StoreStorage, { StorageKey } from './StoreStorage'

const storage = new StoreStorage()

export default storage
export { StorageKey }
export { nonSessionStorageKey } from './non-session-key'
