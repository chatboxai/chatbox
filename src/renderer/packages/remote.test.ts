import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChatboxAIGroupViews } from '@/components/ModelSelectorV2/chatboxCatalog'
import { getChatboxAIModelList, getModelManifest } from './remote'

const { afetch } = vi.hoisted(() => ({ afetch: vi.fn() }))

vi.mock('@shared/request/request', () => ({ createAfetch: () => afetch }))
vi.mock('@shared/request/chatboxai_pool', () => ({ getChatboxAPIOrigin: () => 'https://example.test' }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    getPlatform: async () => 'web',
    getVersion: async () => 'test',
  },
}))
vi.mock('@/stores/authInfoStore', () => ({ authInfoStore: {} }))
vi.mock('@/variables', () => ({ CHATBOX_BUILD_CHANNEL: 'test', USE_BETA_CHATBOX: false, USE_LOCAL_CHATBOX: false }))
vi.mock('./navigator', () => ({ getOS: () => 'Unknown' }))

const supportedModels = [
  { modelId: 'chat', modelName: 'Chat', apiStyle: 'openai' },
  { modelId: 'responses', modelName: 'Responses', apiStyle: 'openai-responses' },
  { modelId: 'legacy', modelName: 'Legacy' },
]
const incompatibleModels = [
  { modelId: 'future', modelName: 'Future', apiStyle: 'future-api' },
  { modelId: 'future-capability', modelName: 'Future capability', capabilities: ['future-capability'] },
  { modelId: 'malformed' },
  null,
]
const image = { modelId: 'image', modelName: 'Image', type: 'image', apiStyle: 'openai' }

function respond(data: unknown) {
  afetch.mockResolvedValue({ json: async () => ({ success: true, data }) })
}

describe('remote model catalog compatibility', () => {
  beforeEach(() => afetch.mockReset())

  it('keeps supported manifest models and images when other entries are incompatible', async () => {
    respond({
      groupName: 'Chatbox AI',
      models: [...supportedModels, ...incompatibleModels],
      imageModels: [...incompatibleModels, image],
    })

    const result = await getModelManifest({ aiProvider: 'chatbox-ai' })

    expect(result.models).toEqual(supportedModels)
    expect(result.imageModels).toEqual([image])
  })

  it('keeps model-list metadata and skips filtered IDs in the rendered groups', async () => {
    const models = Object.fromEntries(supportedModels.map((model) => [model.modelId, model]))
    const rejected = Object.fromEntries(incompatibleModels.map((model, index) => [`invalid-${index}`, model]))
    respond({
      provider: { id: 'chatbox-ai', name: 'Chatbox AI' },
      groups: [{ id: 'basic', modelIds: [...Object.keys(rejected), ...Object.keys(models)] }],
      models: {
        ...rejected,
        ...models,
        priced: { ...supportedModels[0], modelId: 'priced', access: { available: false }, costLevel: 'high' },
        'bad-price': { ...supportedModels[0], modelId: 'bad-price', pricing: { tieredPricing: 'invalid' } },
      },
      imageModels: [...incompatibleModels, image],
    })

    const result = await getChatboxAIModelList({})

    expect(Object.keys(result.models)).toEqual(['chat', 'responses', 'legacy', 'priced'])
    expect(result.models.responses.apiStyle).toBe('openai-responses')
    expect(result.models.priced).toMatchObject({ access: { available: false }, costLevel: 'high' })
    expect(result.imageModels).toEqual([image])
    expect(
      buildChatboxAIGroupViews({ catalog: result, search: '', expandedAdvanced: false, collapsedGroupIds: new Set() })
    ).toEqual([expect.objectContaining({ modelIds: ['chat', 'responses', 'legacy'], total: 3 })])
  })

  it('returns empty collections when every model is incompatible', async () => {
    respond({ groupName: 'Chatbox AI', models: incompatibleModels })
    expect(await getModelManifest({ aiProvider: 'chatbox-ai' })).toMatchObject({ models: [], imageModels: [] })

    respond({
      provider: { id: 'chatbox-ai', name: 'Chatbox AI' },
      groups: [],
      models: { future: incompatibleModels[0] },
    })
    expect(await getChatboxAIModelList({})).toMatchObject({ models: {}, imageModels: [] })
  })

  it('rejects malformed response envelopes and collection shapes', async () => {
    respond({ groupName: 'Chatbox AI', models: {} })
    await expect(getModelManifest({ aiProvider: 'chatbox-ai' })).rejects.toThrow()

    respond({ provider: { id: 'chatbox-ai', name: 'Chatbox AI' }, groups: [], models: [] })
    await expect(getChatboxAIModelList({})).rejects.toThrow()

    respond({ models: {} })
    await expect(getChatboxAIModelList({})).rejects.toThrow()
  })
})
