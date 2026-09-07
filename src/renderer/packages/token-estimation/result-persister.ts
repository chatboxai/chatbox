import type {
  SessionAttachmentDerivedPatch,
  SessionMessageDerivedPatch,
  SessionTextTokenResult,
} from '@chatbox/core/ports'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { clearExactTokenizationFallbacks, recordExactTokenizationFallback } from './exact-retry'
import type { ComputationTask, TaskResult, TokenCacheKey } from './types'

const log = getLogger('token-estimation:persister')

interface PendingUpdate {
  sessionId: string
  patch: SessionMessageDerivedPatch
  textResults?: SessionTextTokenResult[]
}

class ResultPersister {
  private pendingUpdates = new Map<string, PendingUpdate>()
  private inFlightUpdates: ReadonlyMap<string, PendingUpdate> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly throttleMs = 1000
  private lastFlushTime = 0
  private listeners = new Set<() => void>()
  private flushPromise: Promise<void> | null = null
  private failed = false
  private epoch = 0

  addResult(result: NonNullable<TaskResult['result']>): void {
    const key = JSON.stringify([result.sessionId, result.messageId])
    const pending = this.pendingUpdates.get(key) ?? {
      sessionId: result.sessionId,
      patch: { messageId: result.messageId },
    }
    if (result.type === 'message-text') {
      if (result.textDigest === undefined) return
      if (result.textSource) {
        if (
          result.textSource.sessionId !== result.sessionId ||
          result.textSource.messageId !== result.messageId ||
          result.textSource.textDigest !== result.textDigest
        )
          return
        pending.textResults ??= []
        const values = pending.textResults
        const entry: SessionTextTokenResult = {
          source: result.textSource,
          value: {
            tokenizerType: result.tokenizerType,
            sourceDigest: result.textDigest,
            tokens: result.tokens,
            calculatedAt: result.calculatedAt,
            approximate: result.approximate === true,
          },
        }
        const index = values.findIndex(
          (value) =>
            value.source.payloadId === entry.source.payloadId && value.value.tokenizerType === entry.value.tokenizerType
        )
        if (index < 0) values.push(entry)
        else if (values[index].value.calculatedAt <= entry.value.calculatedAt) values[index] = entry
        this.pendingUpdates.set(key, pending)
        this.scheduleFlush()
        return
      }
      pending.patch.text ??= []
      const text = pending.patch.text
      const previous = text.findIndex(
        (entry) => entry.tokenizerType === result.tokenizerType && entry.sourceDigest === result.textDigest
      )
      if (previous < 0 || text[previous].calculatedAt <= result.calculatedAt) {
        const entry = {
          tokenizerType: result.tokenizerType,
          sourceDigest: result.textDigest,
          tokens: result.tokens,
          calculatedAt: result.calculatedAt,
          approximate: result.approximate === true,
        }
        if (previous < 0) text.push(entry)
        else text[previous] = entry
      }
    } else {
      if (!result.attachmentId || !result.attachmentType || !result.sourceStorageKey || result.sourceName === undefined)
        return
      const cacheKey: TokenCacheKey =
        result.contentMode === 'preview' ? `${result.tokenizerType}_preview` : result.tokenizerType
      pending.patch.attachments ??= []
      const attachments = pending.patch.attachments
      let attachment = attachments.find(
        (entry) =>
          entry.id === result.attachmentId &&
          entry.type === result.attachmentType &&
          entry.sourceStorageKey === result.sourceStorageKey &&
          entry.sourceName === result.sourceName
      )
      if (!attachment) {
        attachment = {
          id: result.attachmentId,
          type: result.attachmentType,
          sourceStorageKey: result.sourceStorageKey,
          sourceName: result.sourceName,
        }
        attachments.push(attachment)
      }
      if ((attachment.tokenCalculatedAt?.[cacheKey] ?? 0) <= result.calculatedAt) {
        attachment.tokenCountMap = { ...attachment.tokenCountMap, [cacheKey]: result.tokens }
        attachment.tokenCalculatedAt = { ...attachment.tokenCalculatedAt, [cacheKey]: result.calculatedAt }
      }
      if ((attachment.metadataCalculatedAt ?? 0) <= result.calculatedAt) {
        attachment.metadataCalculatedAt = result.calculatedAt
        attachment.lineCount = result.lineCount
        attachment.byteLength = result.byteLength
      }
    }
    this.pendingUpdates.set(key, pending)
    this.scheduleFlush()
  }

  getPendingCount(): number {
    return this.pendingUpdates.size
  }

  hasPendingExactTextResult(
    task: Pick<ComputationTask, 'type' | 'sessionId' | 'messageId' | 'tokenizerType' | 'textDigest' | 'textSource'>
  ): boolean {
    if (task.type !== 'message-text' || task.textDigest === undefined) return false
    const key = JSON.stringify([task.sessionId, task.messageId])
    const matches = (update: PendingUpdate | undefined) =>
      update?.textResults?.some(
        (entry) =>
          entry.value.tokenizerType === task.tokenizerType &&
          entry.value.sourceDigest === task.textDigest &&
          (!task.textSource ||
            task.textSource === 'read-current' ||
            task.textSource.payloadId === entry.source.payloadId) &&
          entry.value.approximate !== true
      ) === true ||
      update?.patch.text?.some(
        (entry) =>
          entry.tokenizerType === task.tokenizerType &&
          entry.sourceDigest === task.textDigest &&
          entry.approximate !== true
      ) === true
    return matches(this.pendingUpdates.get(key)) || matches(this.inFlightUpdates?.get(key))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    while (this.flushPromise || this.pendingUpdates.size) {
      if (!this.flushPromise) this.doFlush()
      await this.flushPromise
      if (this.failed) throw new Error('Text token persistence remains pending after a failed write')
    }
  }

  cancel(): void {
    this.epoch++
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.pendingUpdates.clear()
  }

  private scheduleFlush(): void {
    if (this.flushPromise || this.flushTimer) return
    const wait = this.throttleMs - (Date.now() - this.lastFlushTime)
    if (wait <= 0) this.doFlush()
    else
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.doFlush()
      }, wait)
  }

  private doFlush(): void {
    if (this.flushPromise || !this.pendingUpdates.size) return
    this.lastFlushTime = Date.now()
    this.failed = false
    const updates = this.pendingUpdates
    this.pendingUpdates = new Map()
    this.inFlightUpdates = updates
    const promise = this.flush(updates, this.epoch)
    this.flushPromise = promise
    void promise.finally(() => {
      if (this.flushPromise === promise) this.flushPromise = null
      if (this.inFlightUpdates === updates) this.inFlightUpdates = null
      if (this.pendingUpdates.size && !this.failed) this.scheduleFlush()
    })
  }

  private async flush(updates: ReadonlyMap<string, PendingUpdate>, epoch: number): Promise<void> {
    const bySession = new Map<string, SessionMessageDerivedPatch[]>()
    for (const { sessionId, patch } of updates.values()) {
      const patches = bySession.get(sessionId) ?? []
      patches.push(patch)
      bySession.set(sessionId, patches)
    }
    for (const [sessionId, patches] of bySession) {
      try {
        const contentPatches = patches.filter((patch) => patch.text?.length || patch.attachments?.length)
        const result = contentPatches.length
          ? await rendererApplication.sessions.patchSessionMessageDerivedData(sessionId, contentPatches)
          : { patches: [] }
        for (const patch of result.patches) {
          for (const entry of patch.text ?? []) {
            if (entry.approximate)
              recordExactTokenizationFallback(patch.messageId, entry.tokenizerType, entry.sourceDigest)
            else clearExactTokenizationFallbacks(patch.messageId, entry.tokenizerType, entry.sourceDigest)
          }
        }
        const numerical = [...updates.values()]
          .filter((update) => update.sessionId === sessionId)
          .flatMap((update) => update.textResults ?? [])
        if (numerical.length) {
          const cached = await rendererApplication.sessions.acceptSessionTextTokenResults(sessionId, numerical)
          const seen = new Set(
            cached.results.map((result) => JSON.stringify([result.source.payloadId, result.value.tokenizerType]))
          )
          const rejected = numerical.filter(
            (result) => !seen.has(JSON.stringify([result.source.payloadId, result.value.tokenizerType]))
          )
          if (rejected.length) {
            const current = await rendererApplication.sessions.readSessionMessages({
              sessionId,
              messageIds: rejected.map((result) => result.source.messageId),
            })
            const rebound = rejected.flatMap((result) => {
              const source = current?.textTokens?.sources[result.source.messageId]
              return source && source.text === result.source.text ? [{ ...result, source }] : []
            })
            if (rebound.length)
              cached.results.push(
                ...(await rendererApplication.sessions.acceptSessionTextTokenResults(sessionId, rebound)).results
              )
          }
          for (const { source, value } of cached.results) {
            if (value.approximate)
              recordExactTokenizationFallback(source.messageId, value.tokenizerType, value.sourceDigest)
            else clearExactTokenizationFallbacks(source.messageId, value.tokenizerType, value.sourceDigest)
          }
        }
      } catch (error) {
        log.error('Failed to flush derived message updates', { sessionId, error })
        if (epoch === this.epoch) {
          for (const [key, update] of updates) {
            if (update.sessionId !== sessionId || !update.textResults?.length) continue
            this.failed = true
            const newer = this.pendingUpdates.get(key)
            if (!newer) this.pendingUpdates.set(key, update)
            else {
              newer.textResults = [...(update.textResults ?? []), ...(newer.textResults ?? [])]
              newer.patch.text = [...(update.patch.text ?? []), ...(newer.patch.text ?? [])]
              newer.patch.attachments = [...(update.patch.attachments ?? []), ...(newer.patch.attachments ?? [])]
            }
          }
        }
      }
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        log.error('Derived update listener failed', { error })
      }
    }
  }
}

export const resultPersister = new ResultPersister()
export { ResultPersister }
export type { PendingUpdate, SessionAttachmentDerivedPatch as AttachmentUpdate }
