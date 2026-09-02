import { type ImageGeneration, ModelProviderEnum } from '@shared/types'
import { requestAppActionApproval } from '@/packages/app-action-approval'
import { type AvailableImageModel, getAvailableImageModels } from '@/packages/image-model-catalog'
import platform from '@/platform'
import storage from '@/storage'
import { rendererApplication } from '@/app/renderer-application'
import { startImageGeneration } from '@/stores/imageGenerationActions'
import { imageGenerationStore } from '@/stores/imageGenerationStore'
import { settingsStore } from '@/stores/settingsStore'
import { getAcceptedImageBackgroundTaskResult } from './background-task-result'
import { getComputePointsRemainingRatio } from './compute-points'
import { queueImageTaskCompletion, queueImageTaskCompletionError } from './image-task-follow-up'
import { ChatboxCliUsageError, integerFlag, stringFlag } from './parser'
import type { ChatboxCliCommandContext, ChatboxCliCommandDefinition } from './types'

const MAX_REFERENCE_LENGTH = 1_000
const IMAGE_EXECUTION_STORAGE_PREFIX = 'chatbox-cli:image-generation-execution'
const executionCache = new Map<string, { signature: string; promise: Promise<Record<string, unknown>> }>()

interface PersistedImageExecution {
  version: 1
  signature: string
  recordId: string
  startedAt: number
}

interface ImageExecutionSignature {
  provider: string
  modelId: string
}

function imageExecutionStorageKey(sessionId: string, toolCallId: string): string {
  return `${IMAGE_EXECUTION_STORAGE_PREFIX}:${sessionId}:${toolCallId}`
}

function isPersistedImageExecution(value: unknown): value is PersistedImageExecution {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.signature === 'string' &&
    typeof record.recordId === 'string' &&
    typeof record.startedAt === 'number'
  )
}

function parseImageExecutionSignature(signature: string): ImageExecutionSignature | undefined {
  try {
    const value = JSON.parse(signature) as Record<string, unknown>
    if (typeof value.provider !== 'string' || typeof value.modelId !== 'string') return undefined
    return { provider: value.provider, modelId: value.modelId }
  } catch {
    return undefined
  }
}

const MAX_MODELS_IN_ERROR = 20

function describeAvailableImageModels(models: AvailableImageModel[]): string {
  if (models.length === 0) {
    return 'No image models are configured. Configure a Chatbox license or an image-capable provider in Chatbox Settings.'
  }
  const entries = models
    .slice(0, MAX_MODELS_IN_ERROR)
    .map((model) =>
      model.nickname && model.nickname !== model.modelId
        ? `${model.provider}/${model.modelId} ("${model.nickname}")`
        : `${model.provider}/${model.modelId}`
    )
  const suffix =
    models.length > MAX_MODELS_IN_ERROR
      ? `, and ${models.length - MAX_MODELS_IN_ERROR} more via "chatbox image models"`
      : ''
  return `Available image models: ${entries.join(', ')}${suffix}.`
}

// Ignore case and punctuation so "GPT Image 2" and "gpt-image-2" reference the same model.
function looseModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Canonicalizes an explicitly requested provider/model against the catalog. Models
// often pass display names or case variants; failing those with a misleading error
// used to make the model retry without --model and silently fall back to the
// default catalog model, overriding the user's choice.
function resolveRequestedImageModel(
  availableModels: AvailableImageModel[],
  requested: { provider?: string; model?: string }
): { provider?: string; modelId?: string } {
  let scoped = availableModels
  let provider: string | undefined
  if (requested.provider !== undefined) {
    const providerKey = requested.provider.trim().toLowerCase()
    scoped = availableModels.filter((model) => model.provider.toLowerCase() === providerKey)
    if (scoped.length === 0) {
      throw new ChatboxCliUsageError(
        `Image model is not available: provider "${requested.provider}" has no configured image models. ${describeAvailableImageModels(availableModels)}`
      )
    }
    provider = scoped[0].provider
  }

  if (requested.model === undefined) return { provider }

  const modelKey = requested.model.trim().toLowerCase()
  const looseKey = looseModelKey(requested.model)
  const tiers = [
    scoped.filter((model) => model.modelId === requested.model),
    scoped.filter((model) => model.modelId.toLowerCase() === modelKey),
    scoped.filter((model) => model.nickname?.trim().toLowerCase() === modelKey),
    looseKey
      ? scoped.filter(
          (model) =>
            looseModelKey(model.modelId) === looseKey ||
            (model.nickname ? looseModelKey(model.nickname) === looseKey : false)
        )
      : [],
  ]
  const matches = tiers.find((tier) => tier.length > 0) ?? []

  if (matches.length === 0) {
    throw new ChatboxCliUsageError(
      `Image model is not available: "${requested.model}". ${describeAvailableImageModels(availableModels)} Pass the exact model id (optionally with --provider).`
    )
  }
  const distinctIds = new Set(matches.map((model) => model.modelId))
  if (distinctIds.size > 1) {
    throw new ChatboxCliUsageError(
      `Image model "${requested.model}" is ambiguous: ${matches
        .map((model) => `${model.provider}/${model.modelId}`)
        .join(', ')}. Pass the exact model id.`
    )
  }
  // The same model id can appear under several providers (e.g. built-in and custom
  // Gemini); keep the catalog-order preference the old exact-id lookup had.
  return { provider: matches[0].provider, modelId: matches[0].modelId }
}

function compactReference(reference: string): string {
  if (reference.startsWith('data:')) return '[inline image omitted]'
  if (reference.length <= MAX_REFERENCE_LENGTH) return reference
  return `${reference.slice(0, MAX_REFERENCE_LENGTH - 1)}…`
}

const IMAGES_ALREADY_DISPLAYED_NOTE =
  'Chatbox already displays these generated images to the user inline at the originating tool call in this chat. Do not render them again: no markdown images and no image links. A brief text confirmation is enough.'

// The originating tool step renders a CLI-sourced record's images inline, so results
// returned to the model in that chat must not carry renderable references the model
// could paste into markdown as a duplicate display. A record only counts as displayed
// while its originating tool call is part of the current thread's messages with the
// accepted background-task result persisted — the exact condition under which the chat
// UI binds the inline gallery. Archived threads, deleted messages, and restored
// non-gallery result shapes keep readable references, since nothing in the active view
// shows those images.
function displayCandidateToolCallId(record: ImageGeneration, currentSessionId: string | undefined): string | undefined {
  return record.source?.type === 'chatbox_cli' &&
    currentSessionId !== undefined &&
    record.source.sessionId === currentSessionId
    ? record.source.toolCallId
    : undefined
}

async function getDisplayedImageToolCallIds(sessionId: string): Promise<ReadonlySet<string>> {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  const ids = new Set<string>()
  for (const message of session?.messages ?? []) {
    for (const part of message.contentParts ?? []) {
      if (part.type === 'tool-call' && getAcceptedImageBackgroundTaskResult(part.result) !== null) {
        ids.add(part.toolCallId)
      }
    }
  }
  return ids
}

function compactRecord(record: ImageGeneration, options?: { displayedInline?: boolean }): Record<string, unknown> {
  const waitingForCompletion = record.status === 'pending' || record.status === 'generating'
  const hasActiveRunner = imageGenerationStore.getState().currentGeneratingId === record.id
  const displayedInline = options?.displayedInline === true && record.generatedImages.length > 0
  return {
    id: record.id,
    status: record.status,
    prompt: record.prompt.slice(0, 500),
    model: record.model,
    aspectRatio: record.aspectRatio,
    imageGenerateNum: record.imageGenerateNum ?? 1,
    createdAt: record.createdAt,
    generatedImages: displayedInline
      ? record.generatedImages
          .slice(0, 4)
          .map((_, index) => `[image ${index + 1} already shown to the user in this chat]`)
      : record.generatedImages.slice(0, 4).map(compactReference),
    generatedImageThumbnails: displayedInline
      ? undefined
      : record.generatedImageThumbnails?.slice(0, 4).map(compactReference),
    error: record.error?.slice(0, 1_000),
    taskId: record.taskId,
    ...(displayedInline ? { note: IMAGES_ALREADY_DISPLAYED_NOTE } : {}),
    ...(waitingForCompletion
      ? {
          wait: hasActiveRunner
            ? {
                mode: 'callback',
                managedBy: 'chatbox',
                modelShouldPoll: false,
              }
            : {
                mode: record.taskId ? 'manual_resume' : 'manual_retry',
                managedBy: 'chatbox',
                modelShouldPoll: false,
                ...(record.taskId ? { location: 'original chat or Image Creator' } : { requiresNewApproval: true }),
              },
        }
      : {}),
  }
}

function restoredExecutionResult(record: ImageGeneration): Record<string, unknown> {
  const waitingForCompletion = record.status === 'pending' || record.status === 'generating'
  const hasActiveRunner = imageGenerationStore.getState().currentGeneratingId === record.id

  if (waitingForCompletion && hasActiveRunner) {
    return {
      accepted: true,
      background: true,
      restored: true,
      recordId: record.id,
      status: 'pending',
      recordStatus: record.status,
      startedAt: record.createdAt,
      model: record.model,
      wait: {
        mode: 'callback',
        managedBy: 'chatbox',
        modelShouldPoll: false,
      },
      message: 'This image request is already running. End this turn and wait for the existing Chatbox callback.',
    }
  }

  return {
    restored: true,
    recordId: record.id,
    // Deliberately unmasked: this restored shape is not an accepted-pending result, so the
    // originating tool step does not bind the inline gallery. The compact references here
    // are the model's only way to surface an already-finished recovered result.
    ...compactRecord(record),
    message: waitingForCompletion
      ? record.taskId
        ? 'This image request was already submitted. Do not submit it again or poll it; resume it from the original chat or Image Creator.'
        : 'This image generation was interrupted without a resumable task id. Do not submit it again without new user approval.'
      : 'This tool call is already linked to the returned image record and was not submitted again.',
  }
}

function cacheExecution(
  key: string,
  signature: string,
  create: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const existing = executionCache.get(key)
  if (existing) {
    if (existing.signature !== signature) {
      return Promise.reject(new Error(`Tool call ${key} was reused with different image arguments.`))
    }
    return existing.promise
  }
  const promise = create()
  executionCache.set(key, { signature, promise })
  void promise.catch(() => {
    if (executionCache.get(key)?.promise === promise) executionCache.delete(key)
  })
  if (executionCache.size > 100) {
    const oldest = executionCache.keys().next().value
    if (typeof oldest === 'string') executionCache.delete(oldest)
  }
  return promise
}

async function generateImage(context: ChatboxCliCommandContext): Promise<Record<string, unknown>> {
  if (!context.sessionId) throw new ChatboxCliUsageError('Image generation requires an active chat session.')
  if (!context.toolCallId) throw new ChatboxCliUsageError('Image generation requires a tool call id.')
  const sessionId = context.sessionId
  const toolCallId = context.toolCallId
  const requestedPrompt = stringFlag(context.parsed, 'prompt') ?? context.parsed.positionals.join(' ').trim()
  if (!requestedPrompt) throw new ChatboxCliUsageError('Missing --prompt.')
  if (requestedPrompt.length > 8_000) throw new ChatboxCliUsageError('Prompt must be at most 8000 characters.')

  const requestedProvider = stringFlag(context.parsed, 'provider')
  const requestedModelId = stringFlag(context.parsed, 'model')
  const requestedCount = integerFlag(context.parsed, 'count', { defaultValue: 1, min: 1, max: 4 })
  const requestedAspectRatio = stringFlag(context.parsed, 'aspect-ratio')
  const requestedStyle = stringFlag(context.parsed, 'style')
  if (requestedStyle && requestedStyle !== 'vivid' && requestedStyle !== 'natural') {
    throw new ChatboxCliUsageError('--style must be vivid or natural.')
  }
  const parsedStyle: 'vivid' | 'natural' | undefined =
    requestedStyle === 'vivid' || requestedStyle === 'natural' ? requestedStyle : undefined
  const approvedRequest =
    context.approved && context.approvalDetails?.type === 'image_generation' ? context.approvalDetails : undefined

  const settings = settingsStore.getState()
  let availableModels: AvailableImageModel[] | undefined
  const ensureAvailableModels = async () => {
    availableModels ??= await getAvailableImageModels(settings)
    return availableModels
  }

  // Canonicalize explicit --provider/--model before anything compares or persists
  // them, so a display-name or case variant means the same request as the exact id.
  let resolvedProviderFlag: string | undefined
  let resolvedModelFlag: string | undefined
  if (requestedProvider !== undefined || requestedModelId !== undefined) {
    const resolved = resolveRequestedImageModel(await ensureAvailableModels(), {
      provider: requestedProvider,
      model: requestedModelId,
    })
    resolvedProviderFlag = resolved.provider
    resolvedModelFlag = resolved.modelId
  }

  // Guard each field only when its flag was explicitly passed, comparing the canonical
  // value. A provider inferred from a --model lookup is a catalog-order preference, not
  // part of the request; treating it as one would falsely reject continuations whose
  // approved model id exists under several providers.
  if (
    approvedRequest &&
    (approvedRequest.prompt !== requestedPrompt ||
      approvedRequest.count !== requestedCount ||
      approvedRequest.aspectRatio !== requestedAspectRatio ||
      approvedRequest.style !== parsedStyle ||
      (requestedProvider !== undefined && approvedRequest.provider !== resolvedProviderFlag) ||
      (requestedModelId !== undefined && approvedRequest.modelId !== resolvedModelFlag))
  ) {
    throw new Error('The image request changed after approval. Ask the user to review it again.')
  }

  const prompt = approvedRequest?.prompt ?? requestedPrompt
  const count = approvedRequest?.count ?? requestedCount
  const aspectRatio = approvedRequest?.aspectRatio ?? requestedAspectRatio
  const dalleStyle = approvedRequest?.style ?? parsedStyle

  const cacheKey = `${sessionId}:${toolCallId}`
  const persistedExecutionKey = imageExecutionStorageKey(sessionId, toolCallId)
  const existing = executionCache.get(cacheKey)
  const persistedExecutionValue = existing ? null : await storage.getItem<unknown>(persistedExecutionKey, null)
  if (persistedExecutionValue !== null && !isPersistedImageExecution(persistedExecutionValue)) {
    throw new Error(`Stored image execution metadata is invalid for tool call ${cacheKey}.`)
  }
  const boundSignature = existing?.signature ?? persistedExecutionValue?.signature
  const boundRequest = boundSignature ? parseImageExecutionSignature(boundSignature) : undefined
  if (boundSignature && !boundRequest) {
    throw new Error(`Stored image execution signature is invalid for tool call ${cacheKey}.`)
  }

  let provider = approvedRequest?.provider ?? resolvedProviderFlag ?? boundRequest?.provider
  let modelId = approvedRequest?.modelId ?? resolvedModelFlag ?? boundRequest?.modelId
  if (!provider || !modelId) {
    const models = await ensureAvailableModels()
    const scoped = provider ? models.filter((model) => model.provider === provider) : models
    const selected = modelId ? scoped.find((model) => model.modelId === modelId) : scoped[0]
    provider ??= selected?.provider
    modelId ??= selected?.modelId
  }
  if (!provider || !modelId) {
    throw new ChatboxCliUsageError(
      availableModels?.length
        ? `Unable to resolve an image model. ${describeAvailableImageModels(availableModels)}`
        : 'No image models are configured. Configure a Chatbox license or an image-capable provider in Chatbox Settings, then retry.'
    )
  }
  const signature = JSON.stringify({ prompt, provider, modelId, count, aspectRatio, dalleStyle })
  if (existing) {
    if (existing.signature !== signature) {
      throw new Error(`Tool call ${cacheKey} was reused with different image arguments.`)
    }
    return existing.promise
  }

  if (persistedExecutionValue !== null) {
    if (persistedExecutionValue.signature !== signature) {
      throw new Error(`Tool call ${cacheKey} was reused with different image arguments.`)
    }
    const persistedRecord = await platform.getImageGenerationStorage().getById(persistedExecutionValue.recordId)
    if (!persistedRecord) {
      throw new Error(
        'The image record linked to this approved tool call no longer exists. Start a new request and ask the user to approve it again.'
      )
    }
    return restoredExecutionResult(persistedRecord)
  }

  if (settings.providers?.[provider]?.excludedModels?.includes(modelId)) {
    throw new ChatboxCliUsageError(`Image model is disabled in settings: ${provider}/${modelId}`)
  }
  const catalog = await ensureAvailableModels()
  if (!catalog.some((model) => model.provider === provider && model.modelId === modelId)) {
    throw new ChatboxCliUsageError(
      `Image model is not available: ${provider}/${modelId}. ${describeAvailableImageModels(catalog)}`
    )
  }

  if (!approvedRequest) {
    const licenseDetail = settings.licenseDetail
    await requestAppActionApproval(
      toolCallId,
      'image.generate',
      'Generate image',
      [
        `Provider: ${JSON.stringify(provider)}`,
        `Model: ${JSON.stringify(modelId)}`,
        `Images: ${count}`,
        ...(aspectRatio ? [`Aspect ratio: ${JSON.stringify(aspectRatio)}`] : []),
        ...(dalleStyle ? [`Style: ${JSON.stringify(dalleStyle)}`] : []),
        `Prompt: ${JSON.stringify(prompt)}`,
      ].join('\n'),
      {
        type: 'image_generation',
        provider,
        modelId,
        prompt,
        count,
        aspectRatio,
        style: dalleStyle,
        billing: provider === ModelProviderEnum.ChatboxAI ? 'chatbox_quota' : 'provider',
        ...(provider === ModelProviderEnum.ChatboxAI && licenseDetail
          ? {
              imageQuota: {
                remaining: Math.max(licenseDetail.image_total_quota - licenseDetail.image_used_count, 0),
                total: licenseDetail.image_total_quota,
              },
              computePointsRemainingRatio: getComputePointsRemainingRatio(licenseDetail),
            }
          : {}),
      }
    )
    throw new Error('Image generation cannot start without matching structured approval details.')
  }

  if (context.abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')

  return cacheExecution(cacheKey, signature, async () => {
    const handle = await startImageGeneration(
      {
        prompt,
        referenceImages: [],
        model: { provider, modelId },
        imageGenerateNum: count,
        aspectRatio,
        dalleStyle,
        source: {
          type: 'chatbox_cli',
          sessionId,
          toolCallId,
        },
      },
      {
        onRecordCreated: async (record) => {
          await storage.setItemNow<PersistedImageExecution>(persistedExecutionKey, {
            version: 1,
            signature,
            recordId: record.id,
            startedAt: record.createdAt,
          })
        },
      }
    )

    void handle.completion
      .then((record) => {
        if (record) queueImageTaskCompletion(record, { sessionId, toolCallId }, handle.startedAt)
      })
      .catch((error: unknown) => {
        queueImageTaskCompletionError(handle.recordId, handle.startedAt, { sessionId, toolCallId }, error)
      })

    return {
      accepted: true,
      background: true,
      recordId: handle.recordId,
      status: 'pending',
      startedAt: handle.startedAt,
      model: { provider, modelId },
      wait: {
        mode: 'callback',
        managedBy: 'chatbox',
        modelShouldPoll: false,
        ...(handle.monitoring.mode === 'polling' ? { pollIntervalMs: handle.monitoring.intervalMs } : {}),
      },
      message: 'Image generation is running in the background. End this turn and wait for Chatbox to call you back.',
    }
  })
}

export const imageCommands: ChatboxCliCommandDefinition[] = [
  {
    path: ['image', 'generate'],
    description:
      'Request approval, then start a callback-driven image background task. Never poll for completion. When the user names a model, pass --model (model id or display name); without --model the first catalog model is used.',
    usage:
      'chatbox image generate --prompt <text> [--provider <id>] [--model <id-or-name>] [--count 1] [--aspect-ratio <ratio>]',
    execute: generateImage,
  },
  {
    path: ['image', 'status'],
    description: 'Read an image generation record.',
    usage: 'chatbox image status <record-id>',
    async execute({ parsed, sessionId }) {
      const recordId = parsed.positionals[0]
      if (!recordId) throw new ChatboxCliUsageError('Missing image generation record id.')
      const record = await platform.getImageGenerationStorage().getById(recordId)
      if (!record) throw new ChatboxCliUsageError(`Image generation record not found: ${recordId}`)
      const candidateToolCallId = displayCandidateToolCallId(record, sessionId)
      const displayedInline =
        candidateToolCallId !== undefined &&
        sessionId !== undefined &&
        (await getDisplayedImageToolCallIds(sessionId)).has(candidateToolCallId)
      return compactRecord(record, { displayedInline })
    },
  },
  {
    path: ['image', 'history'],
    description: 'List recent image generation records.',
    usage: 'chatbox image history [--limit 10] [--cursor 0]',
    async execute({ parsed, sessionId }) {
      const limit = integerFlag(parsed, 'limit', { defaultValue: 10, min: 1, max: 20 })
      const cursor = integerFlag(parsed, 'cursor', { defaultValue: 0, min: 0, max: 10_000_000 })
      const page = await platform.getImageGenerationStorage().getPage(cursor, limit)
      const candidateIds = page.items.map((item) => displayCandidateToolCallId(item, sessionId))
      const displayedToolCallIds =
        sessionId !== undefined && candidateIds.some((id) => id !== undefined)
          ? await getDisplayedImageToolCallIds(sessionId)
          : undefined
      return {
        scope: 'global',
        items: page.items.map((item, index) => {
          const candidateId = candidateIds[index]
          return compactRecord(item, {
            displayedInline: candidateId !== undefined && displayedToolCallIds?.has(candidateId) === true,
          })
        }),
        nextCursor: page.nextCursor,
        total: page.total,
      }
    },
  },
  {
    path: ['image', 'models'],
    description:
      'List configured image-capable models without exposing provider credentials. Run this when the user asks which models exist or names a model you cannot resolve.',
    usage: 'chatbox image models',
    async execute() {
      const models = await getAvailableImageModels()
      return {
        models,
        defaultModel: models[0] ?? null,
      }
    },
  },
]

export function resetImageCommandExecutionsForTests(): void {
  executionCache.clear()
}
