import type { Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import type { PictureRef } from './-modelRigSettings'
import { describeError, effectiveParserType, type ModelRigSlotId, searchProvider } from './-modelRigSettings'

export type SlotTestStatus = 'idle' | 'testing' | 'ok' | 'fail'

export type SlotTestResult = {
  status: 'ok' | 'fail'
  latencyMs: number
  error?: string
  fix?: string
}

export type ModelRigTestDeps = {
  settings: Settings
  configuredProviderIds: ReadonlySet<string>
  picture?: PictureRef
  hasLicense: boolean
  isDesktopLike: boolean
  pingChat: (provider: string, modelId: string, vision?: boolean) => Promise<void>
  testMineru: (token: string) => Promise<boolean>
  searchWeb: () => Promise<void>
}

const CHATBOX_OCR_MODEL_ID = 'chatbox-ocr-1'

async function timed(run: () => Promise<void>): Promise<{ latencyMs: number }> {
  const started = performance.now()
  await run()
  return { latencyMs: Math.round(performance.now() - started) }
}

function fail(error: string, fix: string, latencyMs = 0): SlotTestResult {
  return { status: 'fail', latencyMs, error, fix }
}

function ok(latencyMs: number): SlotTestResult {
  return { status: 'ok', latencyMs }
}

export async function runSlotTest(slotId: ModelRigSlotId, deps: ModelRigTestDeps): Promise<SlotTestResult> {
  try {
    switch (slotId) {
      case 'asr':
      case 'tts':
        return fail('This feature is not available yet', 'No setup is needed.')
      case 'llm':
      case 'fast':
        return await testChatSlot(slotId, deps)
      case 'ocr':
        return await testOcrSlot(deps)
      case 'embedding':
      case 'rerank':
        return await testMemorySlot(slotId, deps)
      case 'parser':
        return await testParserSlot(deps)
      case 'search':
        return await testSearchSlot(deps)
      case 'image':
        return testImageSlot(deps)
    }
  } catch (error) {
    const described = describeError(error)
    return fail(described.error, described.fix)
  }
}

async function testChatSlot(slotId: 'llm' | 'fast', deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const selection = slotId === 'llm' ? deps.settings.defaultChatModel : deps.settings.threadNamingModel
  if (!selection) return ok(0)
  const { latencyMs } = await timed(() => pingResolvedChat(deps, selection.provider, selection.model))
  return ok(latencyMs)
}

async function testOcrSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const selection = deps.settings.ocrModel
  if (!selection) {
    if (!deps.hasLicense) {
      return fail('No OCR model is available', 'Activate Chatbox AI, or pick a vision model of your own.')
    }
    const { latencyMs } = await timed(() =>
      pingResolvedChat(deps, ModelProviderEnum.ChatboxAI, CHATBOX_OCR_MODEL_ID, true)
    )
    return ok(latencyMs)
  }
  const { latencyMs } = await timed(() => pingResolvedChat(deps, selection.provider, selection.model, true))
  return ok(latencyMs)
}

function testMemorySlot(slotId: 'embedding' | 'rerank', deps: ModelRigTestDeps): SlotTestResult {
  const selection = slotId === 'embedding' ? deps.settings.defaultEmbeddingModel : deps.settings.defaultRerankModel
  if (!selection || isChatboxProviderSafe(selection.provider)) {
    if (!deps.hasLicense) {
      return fail(
        'Chatbox AI is not activated',
        slotId === 'embedding'
          ? 'Activate Chatbox AI to use the built-in embedding model, or pick one from a provider you already configured.'
          : 'Activate Chatbox AI to use the built-in rerank model, or pick one from a provider you already configured.'
      )
    }
    return ok(0)
  }
  if (!deps.configuredProviderIds.has(selection.provider)) {
    return fail(
      'This provider is not configured',
      'Check the credentials in Model Provider settings, or choose another provider.'
    )
  }
  return ok(0)
}

async function testParserSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const type = effectiveParserType(deps.settings, deps.isDesktopLike ? 'local' : 'chatbox-ai')
  if (type === 'local') {
    return ok(0)
  }
  if (type === 'chatbox-ai') {
    if (!deps.hasLicense && !deps.isDesktopLike) {
      return fail(
        'Chatbox AI is not activated',
        'Activate Chatbox AI for cloud parsing, or switch to local parsing on desktop.'
      )
    }
    return ok(0)
  }
  const token = deps.settings.extension?.documentParser?.mineru?.apiToken?.trim()
  if (!token) {
    return fail('MinerU API token is missing', 'Add a MinerU API token in Document Parser settings.')
  }
  const { latencyMs } = await timed(async () => {
    const success = await deps.testMineru(token)
    if (!success) {
      throw new Error('MinerU API key invalid')
    }
  })
  return ok(latencyMs)
}

async function testSearchSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const provider = searchProvider(deps.settings)
  if (provider === 'build-in' && !deps.hasLicense) {
    return fail('Chatbox AI is not activated', 'Activate Chatbox AI, or pick another search provider.')
  }
  if (provider === 'tavily' && !deps.settings.extension?.webSearch?.tavilyApiKey) {
    return fail('Tavily API key is missing', 'Add a Tavily API key in Web Search settings.')
  }
  if (provider === 'bocha' && !deps.settings.extension?.webSearch?.bochaApiKey) {
    return fail('BoCha API key is missing', 'Add a BoCha API key in Web Search settings.')
  }
  if (provider === 'querit' && !deps.settings.extension?.webSearch?.queritApiKey) {
    return fail('Querit API key is missing', 'Add a Querit API key in Web Search settings.')
  }
  if (provider === 'searxng' && !deps.settings.extension?.webSearch?.searxngBaseUrl?.trim()) {
    return fail('SearXNG URL is missing', 'Add a SearXNG instance URL in Web Search settings.')
  }
  const { latencyMs } = await timed(() => deps.searchWeb())
  return ok(latencyMs)
}

function testImageSlot(deps: ModelRigTestDeps): SlotTestResult {
  const picture = deps.picture
  if (!picture || isChatboxProviderSafe(picture.provider)) {
    if (!deps.hasLicense) {
      return fail('Chatbox AI is not activated', 'Activate Chatbox AI, or pick an image model from another provider.')
    }
    return ok(0)
  }
  if (!deps.configuredProviderIds.has(picture.provider)) {
    return fail(
      'This provider is not configured',
      'Check the credentials in Model Provider settings, or choose another provider.'
    )
  }
  return ok(0)
}

async function pingResolvedChat(deps: ModelRigTestDeps, provider: string, modelId: string, vision?: boolean) {
  await deps.pingChat(provider, modelId, vision)
}

function isChatboxProviderSafe(provider?: string) {
  return provider === ModelProviderEnum.ChatboxAI
}
