import { throwIfAborted } from './abort'
import { fingerprintResource, readResource, resourceHash } from './blob-stream'
import { sha256Checksum, shouldCompressMimeType } from './codec'
import type { BackupExportOptions } from './export-backup'
import { safeSessionPathComponent } from './export-backup'
import { createBackupProgressReporter } from './progress'
import { BackupReadError } from './read-error'
import type { ResourceReference } from './resources'
import type { BackupResourceEntry } from './types'
import type { ZipArchiveEntry } from './zip'
import { BackupWarningBudgetError, BackupWarningIndex } from './warning-index'

interface ResourceCandidate {
  references: ResourceReference[]
}
function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

function resolveResourceScope(candidate: ResourceCandidate): BackupResourceEntry['scope'] {
  const sessionIds = unique(
    candidate.references.flatMap((reference) => (reference.sessionId ? [reference.sessionId] : []))
  )
  const hasGlobalReference = candidate.references.some((reference) => !reference.sessionId)
  if (sessionIds.length === 0) return 'global'
  if (sessionIds.length === 1 && !hasGlobalReference) return 'session'
  return 'shared'
}

async function resourcePath(
  id: string,
  extension: string,
  scope: BackupResourceEntry['scope'],
  sessionIds: string[],
  checksum: typeof sha256Checksum
): Promise<string> {
  if (scope === 'session' && sessionIds.length === 1) {
    return `sessions/${await safeSessionPathComponent(sessionIds[0], checksum)}/resources/${id}.${extension}`
  }
  return `resources/${id}.${extension}`
}

export class BackupResourceBudgetError extends Error {
  constructor() {
    super('Backup resource references exceed budget')
  }
}

export class BackupResourceCatalog {
  readonly candidates = new Map<string, ResourceCandidate>()
  readonly resources: BackupResourceEntry[] = []
  readonly warnings = new BackupWarningIndex()
  readonly keys = new Map<string, string>()
  successfulKeys = 0
  private referenceCount = 0
  private referenceBytes = 0
  add(references: ResourceReference[]) {
    for (const reference of references) {
      const candidate = this.candidates.get(reference.storageKey)
      if (candidate?.references.some((item) => item.sessionId === reference.sessionId)) continue
      const bytes =
        128 +
        4 *
          (reference.storageKey.length +
            (reference.sessionId?.length ?? 0) +
            (reference.filename?.length ?? 0) +
            (reference.mimeType?.length ?? 0))
      if (this.referenceCount + 1 > 50_000 || this.referenceBytes + bytes > 4 * 1024 * 1024)
        throw new BackupResourceBudgetError()
      this.referenceCount++
      this.referenceBytes += bytes
      if (candidate) {
        if (!candidate.references.some((item) => item.sessionId === reference.sessionId))
          candidate.references.push(reference)
      } else this.candidates.set(reference.storageKey, { references: [reference] })
    }
  }
  async *entries(
    options: Pick<BackupExportOptions, 'storage' | 'checksum' | 'signal' | 'onProgress'>
  ): AsyncGenerator<ZipArchiveEntry> {
    const resourceCandidates = this.candidates
    const resources = this.resources
    const warnings = this.warnings
    const storageKeyToResourceId = this.keys
    const deduplicatedResources = new Map<string, BackupResourceEntry>()
    const checksum = options.checksum ?? sha256Checksum
    const report = createBackupProgressReporter(options.onProgress)
    let successfullyReadResourceKeys = 0
    const resourceCandidateEntries = Array.from(resourceCandidates.entries())
    for (let index = 0; index < resourceCandidateEntries.length; index++) {
      throwIfAborted(options.signal)
      const [storageKey, candidate] = resourceCandidateEntries[index]
      let processedBytes = 0
      const label = candidate.references.find((reference) => reference.filename)?.filename
      report({
        phase: 'resources',
        current: index,
        total: resourceCandidateEntries.length,
        label,
        processedBytes,
      })
      try {
        const firstReference = candidate.references[0]
        const encoded = await fingerprintResource(options.storage, storageKey, firstReference, options.signal)
        if (!encoded) throw new BackupReadError('resource-missing', 'Managed resource is missing from blob storage')
        const resourceChecksum = encoded.checksum
        successfullyReadResourceKeys++
        const dedupeKey = `${resourceChecksum.value}:${encoded.encoding}:${encoded.mimeType}`
        const existingResource = deduplicatedResources.get(dedupeKey)
        const sessionIds = unique(
          candidate.references.flatMap((reference) => (reference.sessionId ? [reference.sessionId] : []))
        )
        if (existingResource) {
          existingResource.originalStorageKeys.push(storageKey)
          existingResource.sessionIds = unique([...existingResource.sessionIds, ...sessionIds])
          const candidateScope = resolveResourceScope(candidate)
          if (
            existingResource.scope !== candidateScope ||
            (existingResource.scope === 'session' && existingResource.sessionIds.length !== 1)
          ) {
            existingResource.scope = 'shared'
          }
          storageKeyToResourceId.set(storageKey, existingResource.id)
          continue
        }

        const id = `resource-${String(resources.length + 1).padStart(6, '0')}`
        const scope = resolveResourceScope(candidate)
        const path = await resourcePath(id, encoded.extension, scope, sessionIds, checksum)
        const resource: BackupResourceEntry = {
          id,
          path,
          originalStorageKeys: [storageKey],
          sessionIds,
          scope,
          encoding: encoded.encoding,
          mimeType: encoded.mimeType,
          kind: firstReference.kind,
          filename: firstReference.filename,
          size: encoded.size,
          checksum: resourceChecksum,
        }
        resources.push(resource)
        deduplicatedResources.set(dedupeKey, resource)
        storageKeyToResourceId.set(storageKey, id)
        yield {
          path,
          data: (async function* () {
            const current = await readResource(options.storage, storageKey, firstReference)
            if (!current || current.encoding !== encoded.encoding || current.mimeType !== encoded.mimeType)
              throw new Error('Managed resource changed during export')
            const hash = resourceHash()
            for await (const bytes of current.chunks) {
              throwIfAborted(options.signal)
              hash.write(bytes)
              yield bytes
              processedBytes += bytes.length
              report({
                phase: 'resources',
                current: index,
                total: resourceCandidateEntries.length,
                label,
                processedBytes,
              })
            }
            const actual = hash.finish()
            if (actual.size !== encoded.size || actual.checksum.value !== encoded.checksum.value)
              throw new Error('Managed resource changed during export')
          })(),
          compress: shouldCompressMimeType(encoded.mimeType),
        }
      } catch (error) {
        throwIfAborted(options.signal)
        if (error instanceof BackupWarningBudgetError) throw error
        warnings.add({
          code: 'resource-read-failed',
          reason: error instanceof BackupReadError ? error.reason : undefined,
          itemType: 'resource',
          itemId: storageKey,
          itemName: candidate.references.find((reference) => reference.filename)?.filename,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    options.onProgress?.({
      phase: 'resources',
      current: resourceCandidateEntries.length,
      total: resourceCandidateEntries.length,
    })

    this.successfulKeys = successfullyReadResourceKeys
  }
}
