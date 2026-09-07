import { withResolvedModelApiStyle } from '@shared/providers/api-style'
import type { ProviderInfo, ProviderModelInfo, ProviderOptions, SessionSettings } from '@shared/types'
import {
  getReasoningProviderOptions,
  type ReasoningControlLevel,
  setReasoningProviderOptionsForModel,
} from '@shared/utils/reasoning-control'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'

type SelectedModel = {
  provider: string
  modelId: string
}

type ReasoningProviderInfo = Pick<ProviderInfo, 'id' | 'type' | 'models' | 'defaultSettings'>

interface UseReasoningControlStateOptions {
  currentSessionId?: string
  isNewSession: boolean
  model?: SelectedModel
  providers: ProviderInfo[]
  sessionProviderOptions?: ProviderOptions
}

interface ReasoningControlState {
  effectiveProviderOptions?: ProviderOptions
  isDirty: boolean
  modelInfo: ProviderModelInfo | null | undefined
  reasoningModelInfo: ProviderModelInfo | null
  selectedProviderInfo?: ProviderInfo
  settingsPatch?: Partial<SessionSettings>
  handleReasoningLevelChange: (level: ReasoningControlLevel) => Promise<void>
  markSettingsCommitted: () => void
  waitForPendingPersist: () => Promise<void>
}

function withProviderApiStyleFallback(
  modelInfo: ProviderModelInfo,
  providerInfo?: Pick<ReasoningProviderInfo, 'id' | 'type'>
): ProviderModelInfo {
  return withResolvedModelApiStyle(modelInfo, {
    providerId: providerInfo?.id,
    providerType: providerInfo?.type,
  })
}

function findProviderModelInfo(model: SelectedModel | undefined, providerInfo: ReasoningProviderInfo | undefined) {
  if (!model) return null
  const foundModel = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
    (item) => item.modelId === model.modelId
  )
  return foundModel ? withProviderApiStyleFallback(foundModel, providerInfo) : undefined
}

/**
 * Resolves the model info used for reasoning-control decisions (capabilities, level,
 * request options). Falls back to a synthetic info carrying the provider's API style
 * when the model is not in the provider's model list. Shared with the session
 * settings modal so both surfaces classify models identically.
 */
export function resolveReasoningModelInfo(
  model: SelectedModel | undefined,
  providerInfo: ReasoningProviderInfo | undefined
): ProviderModelInfo | null {
  if (!model) return null
  const found = findProviderModelInfo(model, providerInfo)
  if (found) return found
  return withProviderApiStyleFallback({ modelId: model.modelId }, providerInfo)
}

interface DraftReasoningEntry {
  options: ProviderOptions | undefined
}

export function useReasoningControlState({
  currentSessionId,
  isNewSession,
  model,
  providers,
  sessionProviderOptions,
}: UseReasoningControlStateOptions): ReasoningControlState {
  const [providerOptionsOverride, setProviderOptionsOverride] = useState<ProviderOptions | undefined>(undefined)
  const [isDirty, setIsDirty] = useState(false)
  // Draft levels chosen before the session exists, keyed per model so switching
  // models while composing the first message does not discard earlier choices.
  const [draftByModel, setDraftByModel] = useState<Record<string, DraftReasoningEntry>>({})

  const selectedProviderInfo = useMemo(
    () => (model ? providers.find((provider) => provider.id === model.provider) : undefined),
    [providers, model]
  )

  const modelInfo = useMemo(() => findProviderModelInfo(model, selectedProviderInfo), [model, selectedProviderInfo])
  const lastResolvedModelRef = useRef<{
    key: string
    modelInfo: ProviderModelInfo
  } | null>(null)

  const modelKey = model ? `${model.provider}:${model.modelId}` : ''
  const sessionKey = currentSessionId || 'new'
  const resetKey = `${sessionKey}:${modelKey}`
  const lastResetKeyRef = useRef(resetKey)
  const lastSessionKeyRef = useRef(sessionKey)
  const changeSeqRef = useRef(0)
  const pendingPersistRef = useRef<Promise<void> | null>(null)
  // Holds the latest options until their persist succeeds, so submit can retry a failed write
  const unpersistedOptionsRef = useRef<{ providerOptions: ProviderOptions | undefined } | null>(null)

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) {
      return
    }
    lastResetKeyRef.current = resetKey
    setProviderOptionsOverride(undefined)
    setIsDirty(false)
    changeSeqRef.current += 1
    pendingPersistRef.current = null
    unpersistedOptionsRef.current = null
    // Drafts are keyed per model, so a model switch keeps them; only leaving the
    // composing context (session change, including creation) clears them.
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey
      setDraftByModel({})
    }
  }, [resetKey, sessionKey])

  useEffect(() => {
    if (modelKey && modelInfo) {
      lastResolvedModelRef.current = {
        key: modelKey,
        modelInfo,
      }
    }
  }, [modelKey, modelInfo])

  const reasoningModelInfo = useMemo<ProviderModelInfo | null>(() => {
    if (!model) return null
    if (modelInfo) return modelInfo
    if (lastResolvedModelRef.current?.key === modelKey) {
      return lastResolvedModelRef.current.modelInfo
    }
    return withProviderApiStyleFallback({ modelId: model.modelId }, selectedProviderInfo)
  }, [model, modelInfo, modelKey, selectedProviderInfo])

  const currentDraft = isNewSession ? draftByModel[modelKey] : undefined
  const effectiveProviderOptions = currentDraft
    ? currentDraft.options
    : isDirty
      ? providerOptionsOverride
      : sessionProviderOptions
  // Existing sessions persist level changes directly (see handleReasoningLevelChange);
  // the patch is only needed when the session does not exist yet and will be created on
  // submit. It carries every per-model draft; 'default' drafts need no entry since a
  // new session starts at the default level anyway.
  const settingsPatch = useMemo<Partial<SessionSettings> | undefined>(() => {
    if (!isNewSession) return undefined
    const byModel: Record<string, ProviderOptions> = {}
    for (const [key, entry] of Object.entries(draftByModel)) {
      if (entry.options) byModel[key] = entry.options
    }
    if (Object.keys(byModel).length === 0) return undefined
    return { providerOptionsByModel: byModel }
  }, [isNewSession, draftByModel])

  const persistProviderOptions = useCallback(
    async (sessionId: string, nextProviderOptions?: ProviderOptions) => {
      await rendererApplication.sessions.updateSession(sessionId, (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        return {
          ...session,
          settings: {
            ...session.settings,
            ...setReasoningProviderOptionsForModel(
              session.settings,
              model?.provider,
              model?.modelId,
              nextProviderOptions
            ),
          },
        }
      })
    },
    [model?.provider, model?.modelId]
  )

  const handleReasoningLevelChange = useCallback(
    async (level: ReasoningControlLevel) => {
      const nextProviderOptions = getReasoningProviderOptions(
        model?.provider,
        reasoningModelInfo,
        level,
        effectiveProviderOptions
      )
      if (isNewSession || !currentSessionId) {
        setDraftByModel((prev) => ({ ...prev, [modelKey]: { options: nextProviderOptions } }))
        return
      }
      setProviderOptionsOverride(nextProviderOptions)
      setIsDirty(true)
      changeSeqRef.current += 1
      const seq = changeSeqRef.current
      unpersistedOptionsRef.current = { providerOptions: nextProviderOptions }
      const persistPromise = persistProviderOptions(currentSessionId, nextProviderOptions).then(() => {
        // Once persisted, the session cache carries the new options; fall back to it
        // unless another change started in the meantime.
        if (changeSeqRef.current === seq) {
          unpersistedOptionsRef.current = null
          setIsDirty(false)
        }
      })
      pendingPersistRef.current = persistPromise
      await persistPromise
    },
    [
      currentSessionId,
      effectiveProviderOptions,
      isNewSession,
      model?.provider,
      modelKey,
      persistProviderOptions,
      reasoningModelInfo,
    ]
  )

  // Called before submit so generation reads the new options from session settings.
  // Awaits the in-flight write and retries it once if it failed.
  const waitForPendingPersist = useCallback(async () => {
    if (isNewSession || !currentSessionId) {
      return
    }
    try {
      if (pendingPersistRef.current) {
        await pendingPersistRef.current
      }
    } catch {
      // fall through to the retry below
    }
    const unpersisted = unpersistedOptionsRef.current
    if (unpersisted) {
      const seq = changeSeqRef.current
      await persistProviderOptions(currentSessionId, unpersisted.providerOptions)
      if (changeSeqRef.current === seq) {
        unpersistedOptionsRef.current = null
        setIsDirty(false)
      }
    }
  }, [currentSessionId, isNewSession, persistProviderOptions])

  const markSettingsCommitted = useCallback(() => {
    setIsDirty(false)
    setDraftByModel({})
  }, [])

  return {
    effectiveProviderOptions,
    isDirty,
    modelInfo,
    reasoningModelInfo,
    selectedProviderInfo,
    settingsPatch,
    handleReasoningLevelChange,
    markSettingsCommitted,
    waitForPendingPersist,
  }
}
