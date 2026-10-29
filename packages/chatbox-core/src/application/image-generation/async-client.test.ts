import { AbortController as ReactNativeAbortController } from 'abort-controller'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestAdapter } from '../../types/adapters'
import { createImageGenerationAsyncClient } from './async-client'

describe('ChatboxAI image protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits references with request-layer retry policy and polls the original task with cancellation', async () => {
    const response = {
      items: [{ uuid: 'image-1', status: 'pending', created_at: '2026-09-08' }],
      task_id: 'task-1',
      is_finished: false,
    }
    const fetchWithOptions = vi.fn(async () => new Response(JSON.stringify(response)))
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions },
      getLicenseKey: () => 'test-license',
      getHeaders: () => ({ 'CHATBOX-PLATFORM': 'ios' }),
    })
    const request = {
      model: 'test-image',
      prompt: 'test',
      response_format: 'b64_json' as const,
      images: [{ image_url: 'data:image/png;base64,test' }],
    }
    await expect(client.submit(request)).resolves.toEqual(response)
    expect(fetchWithOptions).toHaveBeenNthCalledWith(
      1,
      'https://api.chatboxai.app/api/images/async_generations',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-license',
          'Content-Type': 'application/json',
          'CHATBOX-PLATFORM': 'ios',
        },
        body: JSON.stringify(request),
      },
      { parseChatboxRemoteError: true, retry: 2 }
    )
    const controller = new AbortController()
    await client.poll('task-1', controller.signal)
    expect(fetchWithOptions).toHaveBeenNthCalledWith(
      2,
      'https://api.chatboxai.app/api/images/async_generations/task-1',
      expect.objectContaining({ method: 'GET', signal: controller.signal }),
      { parseChatboxRemoteError: true, retry: 2 }
    )
  })

  it('rejects malformed task responses before they can enter persistent history', async () => {
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions: async () => new Response(JSON.stringify({ items: [], is_finished: false })) },
      getLicenseKey: () => 'test',
    })
    await expect(client.poll('task')).rejects.toThrow()
  })

  it('forwards the same native signal and propagates request cancellation', async () => {
    vi.stubGlobal('AbortController', ReactNativeAbortController)
    const controller = new AbortController()
    const cancellation = new Error('FetchRequestCanceledException')
    let markRequested = () => {}
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    const fetchWithOptions = vi.fn<RequestAdapter['fetchWithOptions']>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          markRequested()
          expect(init?.signal).toBe(controller.signal)
          init?.signal?.addEventListener('abort', () => reject(cancellation), { once: true })
        })
    )
    const client = createImageGenerationAsyncClient({
      request: { fetchWithOptions },
      getLicenseKey: () => 'test-license',
    })

    const polling = client.poll('original-task', controller.signal)
    const rejected = expect(polling).rejects.toBe(cancellation)
    await requested
    controller.abort()
    await rejected

    expect(controller.signal.aborted).toBe(true)
    expect(fetchWithOptions).toHaveBeenCalledTimes(1)
  })
})
