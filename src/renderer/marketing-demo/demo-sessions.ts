import { QueryKeys } from '@chatbox/react/query'
import { type ImageGeneration, type Message, ModelProviderEnum, type Session } from '@shared/types'
import { rendererApplication } from '@/app/renderer-application'
import type { DemoLang, DemoSceneId } from '@/marketing-demo/protocol'
import type { DemoImageGenerationPhase } from '@/marketing-demo/scenes'
import { getChatScenes, getSidebarSessions } from '@/marketing-demo/scenes'
import platform from '@/platform'
import { IMAGE_GEN_LIST_QUERY_KEY, IMAGE_GEN_QUERY_KEY, imageGenerationStore } from '@/stores/imageGenerationStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'

export const demoSessionIds: Partial<Record<DemoSceneId, string>> = {}

const DEMO_MODEL = {
  provider: ModelProviderEnum.ChatboxAI,
  modelId: 'chatboxai-3.5',
} as const

export function getDemoModel() {
  return DEMO_MODEL
}

const DEMO_IMAGE_MODEL = {
  provider: ModelProviderEnum.ChatboxAI,
  modelId: 'gemini-3.1-flash-image',
} as const

export function seedDemoImageModels(lang: DemoLang): void {
  const licenseKey = rendererApplication.settingsStore.getState().licenseKey || 'demo'
  rendererApplication.queryClient.setQueryData(['chatbox-ai-models', lang, licenseKey], {
    groupName: 'Chatbox AI',
    models: [
      {
        modelId: DEMO_MODEL.modelId,
        nickname: 'Chatbox AI 3.5',
        type: 'chat',
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
    ],
    imageModels: [
      { modelId: DEMO_IMAGE_MODEL.modelId, modelName: 'Nano Banana 2', type: 'image' },
      { modelId: 'chatboxai-paint', modelName: 'Chatbox AI Paint', type: 'image' },
    ],
    modelList: null,
  })
  lastUsedModelStore.getState().setPictureModel(DEMO_IMAGE_MODEL.provider, DEMO_IMAGE_MODEL.modelId)
}

export async function seedDemoSessions(lang: DemoLang): Promise<void> {
  lastUsedModelStore.getState().setChatModel(DEMO_MODEL.provider, DEMO_MODEL.modelId)
  seedDemoImageModels(lang)
  await rendererApplication.sessions.initialize()
  if (Object.keys(demoSessionIds).length === getChatScenes().length) {
    await renameDemoSessions(lang)
    return
  }

  for (const scene of getChatScenes()) {
    const label = getSidebarSessions(lang).find((item) => item.id === scene)?.label ?? scene
    const session = await rendererApplication.sessions.createSession({
      name: label,
      type: 'chat',
      messages: [],
      settings: {
        provider: DEMO_MODEL.provider,
        modelId: DEMO_MODEL.modelId,
      },
    })
    demoSessionIds[scene] = session.id
  }
}

export async function renameDemoSessions(lang: DemoLang): Promise<void> {
  for (const item of getSidebarSessions(lang)) {
    const sessionId = demoSessionIds[item.id]
    if (!sessionId) continue
    await rendererApplication.sessions.updateSession(sessionId, { name: item.label })
  }
}

export function applyDemoMessages(scene: DemoSceneId, messages: Message[], name: string): void {
  const sessionId = demoSessionIds[scene]
  if (!sessionId) return
  const current = rendererApplication.sessionQueryBridge.getCachedSession(sessionId)
  if (!current) return
  const next: Session = {
    ...current,
    name,
    messages,
  }
  rendererApplication.queryClient.setQueryData(QueryKeys.ChatSession(sessionId), next)
}

const DEMO_IMAGE_RECORD_ID = 'demo-image-generation'
let imageGenerationApplySeq = 0

export function applyDemoInputValue(value: string, scene: DemoSceneId): void {
  const el = (
    scene === 'image-generation' ? document.querySelector('textarea') : document.getElementById('message-input')
  ) as HTMLTextAreaElement | null
  if (!el || el.value === value) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export async function applyDemoImageGeneration(options: {
  phase: DemoImageGenerationPhase
  prompt: string
  images: string[]
}): Promise<void> {
  const seq = ++imageGenerationApplySeq
  const storage = platform.getImageGenerationStorage()
  await storage.initialize()
  if (seq !== imageGenerationApplySeq) return
  imageGenerationStore.getState().setInitialized(true)

  if (options.phase === 'empty') {
    await storage.delete(DEMO_IMAGE_RECORD_ID)
    if (seq !== imageGenerationApplySeq) return
    imageGenerationStore.getState().setCurrentRecordId(null)
    imageGenerationStore.getState().setCurrentGeneratingId(null)
    rendererApplication.queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, DEMO_IMAGE_RECORD_ID], null)
    rendererApplication.queryClient.setQueryData([IMAGE_GEN_LIST_QUERY_KEY], {
      pages: [{ items: [], nextCursor: null, total: 0 }],
      pageParams: [0],
    })
    return
  }

  const existing = await storage.getById(DEMO_IMAGE_RECORD_ID)
  if (seq !== imageGenerationApplySeq) return
  const record: ImageGeneration = {
    id: DEMO_IMAGE_RECORD_ID,
    prompt: options.prompt,
    referenceImages: [],
    generatedImages: options.images,
    createdAt: existing?.createdAt ?? Date.now(),
    model: {
      provider: DEMO_IMAGE_MODEL.provider,
      modelId: DEMO_IMAGE_MODEL.modelId,
    },
    imageGenerateNum: 1,
    aspectRatio: '1:1',
    status: options.phase === 'generating' ? 'generating' : 'done',
  }

  if (existing) {
    await storage.update(DEMO_IMAGE_RECORD_ID, record)
  } else {
    await storage.create(record)
  }
  if (seq !== imageGenerationApplySeq) return

  rendererApplication.queryClient.setQueryData([IMAGE_GEN_QUERY_KEY, DEMO_IMAGE_RECORD_ID], record)
  rendererApplication.queryClient.setQueryData([IMAGE_GEN_LIST_QUERY_KEY], {
    pages: [{ items: [record], nextCursor: null, total: 1 }],
    pageParams: [0],
  })
  imageGenerationStore.getState().setCurrentRecordId(DEMO_IMAGE_RECORD_ID)
  imageGenerationStore.getState().setCurrentGeneratingId(options.phase === 'generating' ? DEMO_IMAGE_RECORD_ID : null)
}
