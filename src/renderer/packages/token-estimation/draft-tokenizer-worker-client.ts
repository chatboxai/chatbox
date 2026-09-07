import type { DraftTokenizationWorkerRequest, DraftTokenizationWorkerResponse } from './draft-tokenizer-worker-handler'
import type { TokenizerType } from './types'

export type { DraftTokenizationWorkerRequest, DraftTokenizationWorkerResponse } from './draft-tokenizer-worker-handler'

export const DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS = 20_000

interface DraftRequest {
  id: number
  text: string
  tokenizerType: TokenizerType
  resolve: (tokens: number) => void
  reject: (error: unknown) => void
  signal: AbortSignal
  onAbort: () => void
  settled: boolean
  timeoutId: ReturnType<typeof setTimeout> | null
  lowPriority: boolean
}

/**
 * One persistent worker serves all requests: spawning a worker re-evaluates
 * the tokenizer's module-scope ranks table (~100ms), which must be paid once,
 * not per debounced keystroke.
 *
 * The client is single-flight: at most one request is posted to the worker at
 * a time and the rest wait here, where aborting removes them before they are
 * ever posted. Posting eagerly instead would pile stale multi-MB encodes into
 * the worker's message queue during a long editing burst — each one fully
 * encoded and structured-cloned — and the newest draft's exact count would
 * trail by the whole backlog. Aborting the posted request only drops its
 * response; its still-armed timeout tears the worker down if that encode
 * hangs, and the next pump respawns a worker for whatever is waiting.
 */
let draftWorker: Worker | null = null
let nextRequestId = 0
let activeRequest: DraftRequest | null = null
const waitingRequests: DraftRequest[] = []

function abortError(): DOMException {
  return new DOMException('Draft tokenization aborted', 'AbortError')
}

function clearRequestTimeout(request: DraftRequest): void {
  if (request.timeoutId !== null) {
    clearTimeout(request.timeoutId)
    request.timeoutId = null
  }
}

function settleResolve(request: DraftRequest, tokens: number): void {
  if (request.settled) return
  request.settled = true
  request.signal.removeEventListener('abort', request.onAbort)
  request.resolve(tokens)
}

function settleReject(request: DraftRequest, error: unknown): void {
  if (request.settled) return
  request.settled = true
  request.signal.removeEventListener('abort', request.onAbort)
  request.reject(error)
}

function resetWorker(error: Error): void {
  const failed = activeRequest
  activeRequest = null
  if (failed) {
    clearRequestTimeout(failed)
    settleReject(failed, error)
  }
  draftWorker?.terminate()
  draftWorker = null
  // Waiting requests do not fail with the active one: the next pump gives
  // them a fresh worker, so the newest draft still gets its exact count after
  // a stale encode times out.
  pumpQueue()
}

function ensureWorker(): Worker {
  if (draftWorker) return draftWorker

  const worker = new Worker(new URL('./draft-tokenizer.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<DraftTokenizationWorkerResponse>) => {
    const request = activeRequest
    if (!request || request.id !== event.data.id) return
    activeRequest = null
    clearRequestTimeout(request)
    if (typeof event.data.tokens === 'number' && event.data.error === undefined) {
      settleResolve(request, event.data.tokens)
    } else {
      settleReject(request, new Error(event.data.error ?? 'Draft tokenization worker returned no result'))
    }
    pumpQueue()
  }
  worker.onerror = (event) => {
    // A load or uncaught script failure cannot be attributed beyond the
    // request being processed: fail it and respawn for the rest.
    resetWorker(new Error(event.message || 'Draft tokenization worker failed'))
  }
  draftWorker = worker
  return worker
}

/**
 * A low-priority background encode can hold the single-flight slot for many
 * seconds, and the visible draft count must not wait for it. The posted encode
 * cannot be recalled, so the worker is dropped mid-encode and the background
 * request goes back to the head of the low-priority class — still pending, and
 * re-armed with a fresh timeout when the next pump posts it again. The
 * respawned worker re-pays tokenizer initialization, which is far cheaper than
 * stalling an interactive request behind a multi-second background encode.
 */
function preemptActiveLowPriorityEncode(): void {
  const preempted = activeRequest
  if (!preempted || !preempted.lowPriority) return
  activeRequest = null
  clearRequestTimeout(preempted)
  draftWorker?.terminate()
  draftWorker = null
  if (!preempted.settled) {
    const firstLowPriority = waitingRequests.findIndex((waiting) => waiting.lowPriority)
    if (firstLowPriority === -1) {
      waitingRequests.push(preempted)
    } else {
      waitingRequests.splice(firstLowPriority, 0, preempted)
    }
  }
}

function pumpQueue(): void {
  while (!activeRequest && waitingRequests.length > 0) {
    const next = waitingRequests.shift()
    if (!next || next.settled) continue

    let worker: Worker
    try {
      worker = ensureWorker()
    } catch (error) {
      settleReject(next, error)
      continue
    }

    activeRequest = next
    next.timeoutId = setTimeout(() => {
      if (activeRequest === next) {
        resetWorker(new Error('Draft tokenization worker timed out'))
      }
    }, DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS)

    const message: DraftTokenizationWorkerRequest = { id: next.id, text: next.text, tokenizerType: next.tokenizerType }
    try {
      worker.postMessage(message)
    } catch (error) {
      activeRequest = null
      clearRequestTimeout(next)
      settleReject(next, error)
    }
  }
}

export function tokenizeDraftOffMainThread(
  text: string,
  tokenizerType: TokenizerType,
  signal: AbortSignal,
  options?: { lowPriority?: boolean }
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }

    const request: DraftRequest = {
      id: ++nextRequestId,
      text,
      tokenizerType,
      resolve,
      reject,
      signal,
      onAbort: () => {},
      settled: false,
      timeoutId: null,
      lowPriority: options?.lowPriority ?? false,
    }
    request.onAbort = () => {
      if (activeRequest === request) {
        // The posted encode cannot be recalled; reject now and let the
        // response — or the still-armed timeout — free the worker.
        settleReject(request, abortError())
        return
      }
      const index = waitingRequests.indexOf(request)
      if (index !== -1) waitingRequests.splice(index, 1)
      settleReject(request, abortError())
    }
    signal.addEventListener('abort', request.onAbort, { once: true })

    if (request.lowPriority) {
      waitingRequests.push(request)
    } else {
      // The visible draft count must not wait behind background context
      // tasks: a background encode already on the worker is preempted, and an
      // interactive request goes ahead of every low-priority waiter, keeping
      // FIFO order within each class.
      preemptActiveLowPriorityEncode()
      const firstLowPriority = waitingRequests.findIndex((waiting) => waiting.lowPriority)
      if (firstLowPriority === -1) {
        waitingRequests.push(request)
      } else {
        waitingRequests.splice(firstLowPriority, 0, request)
      }
    }
    pumpQueue()
  })
}
