import type { LanguageModelV3StreamPart, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { stepCountIs, streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import { buildLocalViewImage } from './view-image'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII='
const dataUrl = `data:image/png;base64,${png}`
function setup(toolResultImages = false) {
  const store = new Map<string, string>()
  const blobs = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    keys: async () => [...store.keys()],
  }
  const read = vi.fn(async () => png)
  const normalize = vi.fn(async () => dataUrl)
  const controller = new AbortController()
  const options = {
    workspace: { readBase64: read, snapshot: vi.fn(), commit: vi.fn(), readText: vi.fn(), deliver: vi.fn() },
    blobs,
    sessionId: 'session',
    signal: controller.signal,
    normalize,
    toolResultImages,
  }
  const api = buildLocalViewImage(options)
  const execute = (path = 'chart.png') =>
    api.tools.view_image.execute?.(
      { file_path: path },
      { toolCallId: 'image', messages: [], abortSignal: controller.signal }
    )
  return { api, execute, read, normalize, blobs, controller }
}
function toolMessage(result: unknown): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'image',
        toolName: 'view_image',
        output: { type: 'json', value: result as { file_path: string; image_storage_key: string; media_type: string } },
      },
    ],
  }
}

describe('local view_image', () => {
  it('stores normalized image separately and returns only shared compact reference', async () => {
    const s = setup()
    const result = await s.execute()
    expect(result).toEqual({
      file_path: 'chart.png',
      image_storage_key: expect.stringMatching(/^picture:work-view:/),
      media_type: 'image/png',
    })
    expect(JSON.stringify(result)).not.toContain(png)
    expect(s.blobs.set).toHaveBeenCalledWith(expect.any(String), dataUrl)
    expect(s.normalize).toHaveBeenCalledWith(dataUrl, expect.any(AbortSignal), { width: 1, height: 1 })
  })
  it('delivers Chat Completion images as user image parts and replay is idempotent', async () => {
    const s = setup()
    const input = [toolMessage(await s.execute())]
    const result = await s.api.prepareStepMessages(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      role: 'tool',
      content: [{ output: { type: 'text', value: expect.stringContaining('attached') } }],
    })
    expect(result[1]).toMatchObject({ role: 'user', content: [{ type: 'text' }, { type: 'image', image: png }] })
    expect(await s.api.prepareStepMessages(result)).toEqual(result)
    expect(input[0]).toMatchObject({ content: [{ output: { type: 'json' } }] })
  })
  it('embeds native tool image parts for media-capable protocols', async () => {
    const s = setup(true)
    const result = await s.api.prepareStepMessages([toolMessage(await s.execute())])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      content: [{ output: { type: 'content', value: [{ type: 'text' }, { type: 'image-data', data: png }] } }],
    })
  })
  it('bounds current images even when tool call ids repeat and does not read omitted blobs', async () => {
    const s = setup()
    const input: ModelMessage[] = []
    for (let i = 0; i < 8; i++) input.push(toolMessage(await s.execute(`chart${i}.png`)))
    const result = await s.api.prepareStepMessages(input)
    expect(result.filter((message) => message.role === 'user')).toHaveLength(5)
    expect(s.blobs.get).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(result)).not.toContain('[Image from view_image tool: chart0.png]')
  })
  it('rejects traversal, corrupt images and unsafe dimensions before normalization', async () => {
    const s = setup()
    await expect(s.execute('../photo.png')).rejects.toThrow('Invalid workspace path')
    expect(s.read).not.toHaveBeenCalled()
    s.read.mockResolvedValue(btoa('not an image'))
    await expect(s.execute()).rejects.toThrow('Unsupported image')
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    new DataView(bytes.buffer).setUint32(16, 20000)
    s.read.mockResolvedValue(btoa(String.fromCharCode(...bytes)))
    await expect(s.execute()).rejects.toThrow('dimensions are too large')
    expect(s.normalize).not.toHaveBeenCalled()
  })
  it('does not persist images when cancelled during normalization', async () => {
    const s = setup()
    s.normalize.mockImplementation(async () => {
      s.controller.abort()
      return dataUrl
    })
    await expect(s.execute()).rejects.toThrow()
    expect(s.blobs.set).not.toHaveBeenCalled()
  })
})

it.each([false, true])('sends actual image input in SDK second step (tool images: %s)', async (native) => {
  const s = setup(native)
  const prompts: LanguageModelV3Prompt[] = []
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  }
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt)
      const chunks: LanguageModelV3StreamPart[] =
        prompts.length === 1
          ? [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'view',
                toolName: 'view_image',
                input: JSON.stringify({ file_path: 'chart.png' }),
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
            ]
      return { stream: convertArrayToReadableStream(chunks) }
    },
  })
  const result = streamText({
    model,
    prompt: 'Inspect chart.png',
    tools: s.api.tools,
    stopWhen: stepCountIs(2),
    prepareStep: async ({ messages }) => ({ messages: await s.api.prepareStepMessages(messages) }),
  })
  await result.consumeStream()
  expect(prompts).toHaveLength(2)
  if (native)
    expect(prompts[1].find((m) => m.role === 'tool')).toMatchObject({
      content: [{ output: { type: 'content', value: [{ type: 'text' }, { type: 'image-data', data: png }] } }],
    })
  else {
    const last = prompts[1].at(-1)
    expect(last).toMatchObject({
      role: 'user',
      content: [{ type: 'text' }, { type: 'file', mediaType: 'image/png', data: png }],
    })
    expect(JSON.stringify(prompts[1].find((m) => m.role === 'tool'))).not.toContain(png)
  }
})
