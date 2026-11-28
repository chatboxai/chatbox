import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { StoredSyncState } from './types'

interface EncryptedCredentialFile {
  version: 1
  ciphertext: string
}

function credentialPath() {
  return path.join(app.getPath('userData'), 'chatany-sync-credentials.v1.json')
}

function requireCredentialEncryption() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('sync_credential_storage_unavailable')
  }
}

export class SyncCredentialStore {
  private pendingWrite: Promise<void> = Promise.resolve()

  async load(): Promise<StoredSyncState> {
    await this.pendingWrite
    return this.read()
  }

  update(mutate: (current: StoredSyncState) => StoredSyncState): Promise<StoredSyncState> {
    const update = this.pendingWrite.then(async () => {
      const next = mutate(await this.read())
      await this.save(next)
      return next
    })
    this.pendingWrite = update.then(
      () => {},
      () => {}
    )
    return update
  }

  private async read(): Promise<StoredSyncState> {
    try {
      const envelope = JSON.parse(await readFile(credentialPath(), 'utf8')) as EncryptedCredentialFile
      if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string') return {}
      requireCredentialEncryption()
      const plaintext = safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      return JSON.parse(plaintext) as StoredSyncState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async save(state: StoredSyncState): Promise<void> {
    requireCredentialEncryption()

    const target = credentialPath()
    const temporary = `${target}.tmp`
    const envelope: EncryptedCredentialFile = {
      version: 1,
      ciphertext: safeStorage.encryptString(JSON.stringify(state)).toString('base64'),
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(temporary, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
  }
}
