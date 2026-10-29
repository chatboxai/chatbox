import type {
  PortableTokenEstimationResult,
  TokenEstimationRequest,
  TokenEstimationService,
} from '@chatbox/core/application/token-estimation'
import { SessionRowConflictError } from '@chatbox/core/ports'
import type { SessionEventBus } from '@chatbox/core/application/session'
import { useEffect, useRef, useState } from 'react'
export interface RowTokenHistoryOptions {
  service: Pick<TokenEstimationService, 'estimate'>
  events: Pick<SessionEventBus, 'subscribe'>
  enabled: boolean
  request: Omit<TokenEstimationRequest, 'constructedMessage'>
  /** Changes to external instruction data such as the saved memory set. */
  instructionVersion?: string | number
}

/** Private numerical subscription. It never reads or patches transcript query data. */
export function useRowTokenHistory(options: RowTokenHistoryOptions) {
  const { service, events, enabled, request, instructionVersion } = options
  const [epoch, setEpoch] = useState(0)
  const latest = useRef(request)
  latest.current = request
  const inputKey = JSON.stringify([
    request.sessionId,
    request.model?.provider,
    request.model?.modelId,
    request.model?.contextWindow,
    request.maxContextMessageCount,
    request.additionalInstructions,
    request.modelSupportToolUseForFile === true,
    request.sandboxMode === true,
    request.language,
    instructionVersion,
  ])
  const key = `${inputKey}:${epoch}`
  const history = useRef<{ sessionId: string | null | undefined; ids: Set<string> }>({
    sessionId: request.sessionId,
    ids: new Set(),
  })
  if (history.current.sessionId !== request.sessionId)
    history.current = { sessionId: request.sessionId, ids: new Set() }
  const [state, setState] = useState<{
    key: string
    inputKey: string
    result?: PortableTokenEstimationResult
    calculating: boolean
    failed: boolean
  }>({ key: '', inputKey: '', calculating: false, failed: false })
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(
    () =>
      events.subscribe((event) => {
        if (event.type === 'session-deleted' && request.sessionId && event.ids.includes(request.sessionId)) {
          setEpoch((value) => value + 1)
          return
        }
        if (event.type !== 'session-command-committed' || event.delta.sessionId !== request.sessionId) return
        const diff = event.delta.diff
        const previouslyIncluded = diff.messages.upsert.some((row) => history.current.ids.has(row.messageId))
        for (const row of diff.messages.upsert) {
          if (row.facts?.contextEligible === false) history.current.ids.delete(row.messageId)
        }
        const changed =
          previouslyIncluded ||
          event.delta.appendedMessageIds.length > 0 ||
          Boolean(event.delta.structureResult?.applied) ||
          diff.messages.delete.length > 0 ||
          Boolean(diff.messageMetadataUpsert?.length) ||
          diff.messages.upsert.some((row) => row.facts?.contextEligible !== false)
        if (changed) setEpoch((value) => value + 1)
      }),
    [events, request.sessionId]
  )

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let lastProgress = 0
    // Layout acknowledgement enables this effect; the next task starts historical work.
    const timer = setTimeout(() => {
      setState((current) => ({
        key,
        inputKey,
        result: current.inputKey === inputKey ? current.result : undefined,
        calculating: true,
        failed: false,
      }))
      const work = queue.current.then(async () => {
        let retryDelay = 100
        while (!controller.signal.aborted) {
          const currentRequest = latest.current
          try {
            const result = await service.estimate(
              {
                ...currentRequest,
                async resolveInstructions(plan) {
                  if (!controller.signal.aborted)
                    history.current = { sessionId: currentRequest.sessionId, ids: new Set(plan?.messageIds ?? []) }
                  return currentRequest.resolveInstructions
                    ? currentRequest.resolveInstructions(plan)
                    : (currentRequest.additionalInstructions ?? '')
                },
              },
              {
                signal: controller.signal,
                onProgress(result, completed, total) {
                  if (controller.signal.aborted) return
                  const now = Date.now()
                  if (completed !== total && now - lastProgress < 100) return
                  lastProgress = now
                  setState({ key, inputKey, result, calculating: completed !== total, failed: false })
                },
              }
            )
            if (!controller.signal.aborted) setState({ key, inputKey, result, calculating: false, failed: false })
            return
          } catch (error) {
            if (!(error instanceof SessionRowConflictError) || controller.signal.aborted) throw error
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(retry)
                controller.signal.removeEventListener('abort', finish)
                resolve()
              }
              const retry = setTimeout(finish, retryDelay)
              controller.signal.addEventListener('abort', finish, { once: true })
            })
            retryDelay = Math.min(retryDelay * 2, 1000)
          }
        }
      })
      queue.current = work.catch(() => {})
      void work.catch(() => {
        if (!controller.signal.aborted)
          setState((current) => ({
            key,
            inputKey,
            result: current.inputKey === inputKey ? current.result : undefined,
            calculating: false,
            failed: true,
          }))
      })
    }, 0)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [enabled, inputKey, key, service])

  return enabled && state.inputKey === inputKey
    ? { ...state, key, calculating: state.key !== key || state.calculating }
    : { key, result: undefined, calculating: enabled, failed: false }
}
