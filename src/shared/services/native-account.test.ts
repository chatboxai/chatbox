import { describe, expect, it, vi } from 'vitest'
import {
  fetchNativeAccountLicenses,
  fetchNativeAccountProfile,
  fetchNativeChatboxAIModelCatalog,
  fetchNativeChatboxAIModels,
  generateNativeWebAuthToken,
  loginNativeEmailCode,
  refreshNativeAccountTokens,
  sendNativeEmailLoginCode,
} from './native-account'

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
}

describe('native account service', () => {
  it('supports the email login and refresh flow with an injected fetch', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { result: 'ok' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'access', refresh_token: 'refresh' } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { data: { result: 'ok' } },
          { headers: { 'x-chatbox-access-token': 'next-access', 'x-chatbox-refresh-token': 'next-refresh' } }
        )
      )

    await sendNativeEmailLoginCode('user@example.com', 'en', { fetchFn })
    await expect(loginNativeEmailCode('user@example.com', '123456', { fetchFn })).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    await expect(refreshNativeAccountTokens('refresh', { fetchFn })).resolves.toEqual({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    })
  })

  it('normalizes profile and license responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'user-1', email: 'user@example.com' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              key: 'license',
              product_name: 'Pro',
              image_limit: 10,
              unified_token_limit: 20,
            },
          ],
        })
      )

    await expect(fetchNativeAccountProfile('access', { fetchFn })).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
      createdAt: undefined,
    })
    await expect(fetchNativeAccountLicenses('access', { fetchFn })).resolves.toEqual([
      expect.objectContaining({ key: 'license', productName: 'Pro', imageLimit: 10, unifiedTokenLimit: 20 }),
    ])
  })

  it('generates a web authentication token for account links', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ data: { web_auth_token: 'web-token' } }))

    await expect(generateNativeWebAuthToken('access', { fetchFn })).resolves.toBe('web-token')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.chatboxai.app/api/auth/web_auth_token/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-chatbox-access-token': 'access' }),
      })
    )
  })

  it('accepts the camel-case profile creation timestamp', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 1, email: 'user@example.com', createdAt: '2026-08-10' } }))

    await expect(fetchNativeAccountProfile('access', { fetchFn })).resolves.toEqual({
      id: '1',
      email: 'user@example.com',
      createdAt: '2026-08-10',
    })
  })

  it('projects available Chatbox AI models into shared ProviderModelInfo', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            visible: {
              modelId: 'chatbox-model',
              modelName: 'Chatbox Model',
              capabilities: ['vision', 'tool_use'],
              labels: ['pro', 'new'],
              maxOutput: 8192,
              access: { available: true },
            },
            hidden: { modelId: 'hidden', modelName: 'Hidden', access: { available: false } },
          },
          imageModels: [],
        },
      })
    )

    await expect(fetchNativeChatboxAIModels('license', 'en', { fetchFn })).resolves.toEqual([
      expect.objectContaining({
        labels: ['pro', 'new'],
        maxOutput: 8192,
        modelId: 'chatbox-model',
        nickname: 'Chatbox Model',
      }),
    ])
  })

  it('keeps server group membership and ordering independently of model labels and availability', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            first: { modelId: 'first', labels: ['pro'] },
            second: { modelId: 'second', labels: [] },
            hidden: { modelId: 'hidden', access: { available: false } },
          },
          groups: [
            { id: 'basic', modelIds: ['second', 'first'] },
            { id: 'advanced', modelIds: ['hidden'] },
          ],
        },
      })
    )

    const catalog = await fetchNativeChatboxAIModelCatalog('license', 'en', { fetchFn })

    expect(catalog.models.map((model) => model.modelId)).toEqual(['first', 'second'])
    expect(catalog.groups).toEqual([
      { id: 'basic', modelIds: ['second', 'first'] },
      { id: 'advanced', modelIds: ['hidden'] },
    ])
  })

  it('skips malformed group entries and accepts responses without groups', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            models: {},
            groups: [null, { id: 1, modelIds: [] }, { id: 'invalid' }, { id: 'basic', modelIds: ['model', null, 2] }],
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { models: { model: { modelId: 'model', labels: ['pro'] } } } }))

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).resolves.toEqual({
      source: 'model-list',
      models: [],
      groups: [{ id: 'basic', modelIds: ['model'] }],
      modelDetails: {},
    })
    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).resolves.toMatchObject({ groups: [] })
  })

  it('preserves featured model order and distinguishes missing, invalid, and empty recommendations', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {},
          groups: [
            {
              id: 'advanced',
              modelIds: ['first', 'second', 'third', 'fourth', 'fifth'],
              featuredModelIds: ['fifth', null, 12, 'second', false, 'fourth'],
            },
            { id: 'missing', modelIds: ['first'] },
            { id: 'invalid', modelIds: ['first'], featuredModelIds: 'first' },
            { id: 'empty', modelIds: ['first'], featuredModelIds: [] },
          ],
        },
      })
    )

    const catalog = await fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })

    expect(catalog.groups).toEqual([
      {
        id: 'advanced',
        modelIds: ['first', 'second', 'third', 'fourth', 'fifth'],
        featuredModelIds: ['fifth', 'second', 'fourth'],
      },
      { id: 'missing', modelIds: ['first'], featuredModelIds: undefined },
      { id: 'invalid', modelIds: ['first'], featuredModelIds: undefined },
      { id: 'empty', modelIds: ['first'], featuredModelIds: [] },
    ])
  })

  it('retains chat, image, and unavailable model details without changing the selectable models', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            chat: {
              modelId: 'chat',
              modelName: 'Chat Model',
              description: 'A model for everyday questions.',
              costLevel: 'medium',
              capabilities: ['vision', 'reasoning', 'tool_use', 'future-capability'],
            },
            unavailable: {
              modelId: 'unavailable',
              description: 'A model that is temporarily unavailable.',
              costLevel: 'high',
              access: { available: false },
            },
          },
          imageModels: [
            {
              modelId: 'image',
              modelName: 'Image Model',
              type: 'image',
              description: 'Creates pictures.',
              costLevel: 'low',
            },
          ],
          license: { plan: 'pro' },
          links: { upgrade: 'https://chatboxai.app/pricing' },
        },
      })
    )

    const catalog = await fetchNativeChatboxAIModelCatalog('license', 'en', { fetchFn })

    expect(catalog.models.map((model) => model.modelId)).toEqual(['chat', 'image'])
    expect(catalog.modelDetails).toEqual({
      chat: {
        modelId: 'chat',
        modelName: 'Chat Model',
        description: 'A model for everyday questions.',
        costLevel: 'medium',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        available: true,
      },
      unavailable: expect.objectContaining({
        modelId: 'unavailable',
        description: 'A model that is temporarily unavailable.',
        costLevel: 'high',
        available: false,
      }),
      image: expect.objectContaining({
        modelId: 'image',
        modelName: 'Image Model',
        description: 'Creates pictures.',
        costLevel: 'low',
        available: true,
      }),
    })
    expect(catalog.licensePlan).toBe('pro')
    expect(catalog.links).toEqual({ upgrade: 'https://chatboxai.app/pricing' })
    expect(catalog.models[0]).not.toHaveProperty('description')
  })

  it('ignores malformed optional model details without losing valid models', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            valid: {
              modelId: 'valid',
              modelName: 12,
              description: [],
              costLevel: false,
              capabilities: 'vision',
              access: null,
            },
            invalid: { description: 'Missing model ID' },
          },
          imageModels: [null, { modelId: 12 }],
          license: { plan: 12 },
          links: { upgrade: false },
        },
      })
    )

    const catalog = await fetchNativeChatboxAIModelCatalog(undefined, undefined, { fetchFn })

    expect(catalog.models.map((model) => model.modelId)).toEqual(['valid'])
    expect(catalog.modelDetails).toEqual({
      valid: {
        modelId: 'valid',
        modelName: undefined,
        description: undefined,
        costLevel: undefined,
        capabilities: undefined,
        available: true,
      },
    })
    expect(catalog.licensePlan).toBeUndefined()
    expect(catalog.links).toBeUndefined()
  })

  it('retains model types and context limits and identifies image catalog entries with no explicit type', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {
            chat: { modelId: 'chat', type: 'chat', contextWindow: 128_000 },
            embedding: { modelId: 'embedding', type: 'embedding', access: { available: false } },
          },
          imageModels: [{ modelId: 'image', contextWindow: 8_192 }],
        },
      })
    )

    const catalog = await fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })

    expect(catalog.modelDetails.chat).toMatchObject({ type: 'chat', contextWindow: 128_000 })
    expect(catalog.modelDetails.embedding).toMatchObject({ type: 'embedding', available: false })
    expect(catalog.modelDetails.image).toMatchObject({ type: 'image', contextWindow: 8_192 })
    expect(catalog.models.map((model) => model.modelId)).toEqual(['chat', 'image'])
    expect(catalog.models.find((model) => model.modelId === 'image')?.type).toBeUndefined()
  })

  it.each([
    { name: 'not found', payload: {}, status: 404 },
    { name: 'server error', payload: { error: { message: 'Temporarily unavailable' } }, status: 503 },
    { name: 'unsuccessful application response', payload: { success: false, data: { models: {} } } },
    { name: 'application error', payload: { error: { message: 'Unavailable' }, data: { models: {} } } },
    { name: 'nested application error', payload: { data: { error: { message: 'Unavailable' }, models: {} } } },
    { name: 'missing models', payload: { data: {} } },
    { name: 'model array', payload: { data: { models: [] } } },
    { name: 'invalid groups container', payload: { data: { models: {}, groups: {} } } },
    { name: 'invalid images container', payload: { data: { models: {}, imageModels: {} } } },
  ])('falls back to the manifest for $name without inventing catalog permissions', async ({ payload, status }) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(payload, { status: status ?? 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            groupName: 'Pro Models',
            models: [
              {
                modelId: 'chat',
                modelName: 'Chat Model',
                labels: ['pro'],
                capabilities: ['vision'],
                contextWindow: 128_000,
              },
              { modelId: 'invalid' },
            ],
            imageModels: [{ modelId: 'image', modelName: 'Image Model' }],
          },
        })
      )

    const catalog = await fetchNativeChatboxAIModelCatalog('license', 'en', {
      fetchFn,
      apiOrigin: 'https://example.com/',
      headers: { 'CHATBOX-PLATFORM': 'ios' },
    })

    expect(catalog).toMatchObject({
      source: 'manifest',
      models: [
        { modelId: 'chat', nickname: 'Chat Model', labels: ['pro'], capabilities: ['vision'], contextWindow: 128_000 },
        { modelId: 'image', nickname: 'Image Model', type: 'image' },
      ],
      groups: [],
      modelDetails: {},
    })
    expect(catalog.licensePlan).toBeUndefined()
    expect(catalog.links).toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn).toHaveBeenLastCalledWith(
      'https://example.com/api/model_manifest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'CHATBOX-PLATFORM': 'ios' }),
        body: JSON.stringify({ aiProvider: 'chatbox-ai', licenseKey: 'license', language: 'en' }),
      })
    )
  })

  it.each(['network', 'json'])('falls back when the model-list %s request cannot be read', async (failure) => {
    const fetchFn = vi.fn<typeof fetch>()
    if (failure === 'network') fetchFn.mockRejectedValueOnce(new TypeError('Network request failed'))
    else fetchFn.mockResolvedValueOnce(new Response('invalid-json', { status: 200 }))
    fetchFn.mockResolvedValueOnce(jsonResponse({ data: { groupName: 'Models', models: [] } }))

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).resolves.toEqual({
      source: 'manifest',
      models: [],
      groups: [],
      modelDetails: {},
    })
  })

  it('returns a valid empty catalog without requesting the manifest', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: {
          models: {},
          groups: [],
          license: { plan: 'lite' },
          links: { upgrade: 'https://chatboxai.app/pricing' },
        },
      })
    )

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).resolves.toEqual({
      source: 'model-list',
      models: [],
      groups: [],
      modelDetails: {},
      licensePlan: 'lite',
      links: { upgrade: 'https://chatboxai.app/pricing' },
    })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it.each([
    { data: { models: [] } },
    { data: { groupName: 'Models', models: {} } },
    { data: { groupName: 'Models', models: [], imageModels: {} } },
    { success: false, data: { groupName: 'Models', models: [] } },
  ])('rejects malformed or unsuccessful manifest responses %j', async (payload) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(payload))

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each(['fetch', 'body'])('does not request the manifest when the model-list %s is aborted', async (phase) => {
    const abort = new Error('Cancelled')
    abort.name = 'AbortError'
    const fetchFn = vi.fn<typeof fetch>()
    if (phase === 'fetch') fetchFn.mockRejectedValueOnce(abort)
    else {
      const response = jsonResponse({ data: { models: {} } })
      vi.spyOn(response, 'json').mockRejectedValueOnce(abort)
      fetchFn.mockResolvedValueOnce(response)
    }

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn })).rejects.toBe(abort)
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('stops before starting a request when the signal is already aborted', async () => {
    const fetchFn = vi.fn<typeof fetch>()

    await expect(
      fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn, signal: { aborted: true } })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('does not fall back when cancellation accompanies a transport failure', async () => {
    const signal = { aborted: false }
    const fetchFn = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      signal.aborted = true
      throw new TypeError('Network request failed')
    })

    await expect(fetchNativeChatboxAIModelCatalog(undefined, 'en', { fetchFn, signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})
