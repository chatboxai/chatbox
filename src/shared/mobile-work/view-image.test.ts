import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { isStepCount, streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { convertToModelMessages } from '../services/model-message-converter'
import type { MessageContentToolCallPart } from '../types'
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
      { toolCallId: 'image', messages: [], context: undefined, abortSignal: controller.signal }
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
      content: [
        { output: { type: 'content', value: [{ type: 'text' }, { type: 'file', data: { type: 'data', data: png } }] } },
      ],
    })
  })
  it('delivers all pending images even when tool call ids repeat', async () => {
    const s = setup()
    const input: ModelMessage[] = []
    for (let i = 0; i < 8; i++) input.push(toolMessage(await s.execute(`chart${i}.png`)))
    const result = await s.api.prepareStepMessages(input)
    expect(result.filter((message) => message.role === 'user')).toHaveLength(8)
    expect(s.blobs.get).toHaveBeenCalledTimes(8)
    expect(JSON.stringify(result)).toContain('[Image from view_image tool: chart0.png]')
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
  const prompts: LanguageModelV4Prompt[] = []
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  }
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt)
      const chunks: LanguageModelV4StreamPart[] =
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
    stopWhen: isStepCount(2),
    // Mirrors AbstractAISDKModel, which prepares every step from the full transcript.
    prepareStep: async ({ initialMessages, responseMessages }) => ({
      messages: await s.api.prepareStepMessages([...initialMessages, ...responseMessages]),
    }),
  })
  await result.consumeStream()
  expect(prompts).toHaveLength(2)
  if (native)
    expect(prompts[1].find((m) => m.role === 'tool')).toMatchObject({
      content: [
        {
          output: {
            type: 'content',
            value: [{ type: 'text' }, { type: 'file', mediaType: 'image/png', data: { type: 'data', data: png } }],
          },
        },
      ],
    })
  else {
    const last = prompts[1].at(-1)
    expect(last).toMatchObject({
      role: 'user',
      content: [{ type: 'text' }, { type: 'file', mediaType: 'image/png', data: { type: 'data', data: png } }],
    })
    expect(JSON.stringify(prompts[1].find((m) => m.role === 'tool'))).not.toContain(png)
  }
})

it.each([true, false])(
  'bounds recovered image history even with no new view_image execution (native=%s)',
  async (native) => {
    const s = setup(native)
    const images: MessageContentToolCallPart[] = Array.from({ length: 8 }, (_, index) => ({
      type: 'tool-call',
      state: 'result',
      toolCallId: `resume-${index}`,
      toolName: 'view_image',
      stepIndex: 0,
      args: { file_path: `page-${index}.png` },
      result: { file_path: `page-${index}.png`, media_type: 'image/png' },
      resultImageStorageKey: `picture:${index}`,
    }))
    const messages = await convertToModelMessages(
      [
        {
          id: 'resume',
          role: 'assistant',
          contentParts: [...images, { type: 'text', text: 'Inspecting.', stepIndex: 0 }],
        },
      ],
      async () => dataUrl,
      { modelSupportVision: true, supportToolResultImages: native }
    )
    const count = (messages: ModelMessage[]) =>
      messages.reduce((total, message) => {
        if (message.role === 'user' && Array.isArray(message.content))
          return total + message.content.filter((part) => part.type === 'image').length
        if (message.role === 'tool')
          return (
            total +
            message.content.reduce(
              (n, part) =>
                n +
                (part.type === 'tool-result' && part.output.type === 'content'
                  ? part.output.value.filter((value) => value.type === 'file').length
                  : 0),
              0
            )
          )
        return total
      }, 0)
    expect(count(await s.api.prepareStepMessages(messages))).toBe(8)
    const history = [...messages, { role: 'assistant' as const, content: 'Inspected.' }]
    expect(count(await s.api.prepareStepMessages(history))).toBe(5)
    expect(s.read).not.toHaveBeenCalled()
    expect(s.blobs.get).not.toHaveBeenCalled()
  }
)
