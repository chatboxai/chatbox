import type { ModelInterface } from '@shared/models/types'
import type { Message, Session } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../domain/settings'
import { BasicGenerationPreparation } from './BasicGenerationPreparation'
import type { GenerationPreparationRequest } from './GenerationService'

type TestContext = { host: 'native' }

function createModel(options: { system?: boolean; vision?: boolean } = {}): ModelInterface {
  return {
    apiStyle: 'openai',
    isSupportSystemMessage: () => options.system !== false,
    isSupportVision: () => options.vision !== false,
  } as unknown as ModelInterface
}

function createRequest(model = createModel()): GenerationPreparationRequest<TestContext> {
  const messages: Message[] = [
    { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'Original system prompt' }] },
    {
      id: 'user',
      role: 'user',
      contentParts: [
        { type: 'text', text: 'Read both inputs' },
        { type: 'image', storageKey: 'image-key' },
      ],
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file-key' }],
    },
    { id: 'assistant', role: 'assistant', generating: true, contentParts: [] },
  ]
  const session: Session = {
    id: 'session',
    name: 'Session',
    type: 'chat',
    settings: { provider: 'openai', modelId: 'test' },
    messages,
  }
  return {
    session,
    settings: session.settings ?? {},
    globalSettings: createDefaultSettings(),
    config: { uuid: 'native-installation' },
    messages,
    targetMessageIndex: 2,
    model,
    modelContext: { host: 'native' },
    attachments: {
      read: vi.fn((storageKey: string) =>
        Promise.resolve(
          storageKey === 'file-key'
            ? 'persisted attachment text'
            : storageKey === 'image-key'
              ? 'data:image/png;base64,aGVsbG8='
              : null
        )
      ),
    },
    webBrowsing: false,
    agentModeValue: 'off',
    agentModeLocked: false,
    agentModeSupported: false,
    signal: new AbortController().signal,
    preserveLastPromptMessageToolCalls: false,
    lockAgentMode: vi.fn(),
  }
}

describe('BasicGenerationPreparation', () => {
  it('uses shared context building and model conversion for persisted native attachments', async () => {
    const request = createRequest()
    const preparation = new BasicGenerationPreparation<TestContext>()

    const prepared = await preparation.prepare(request)

    expect(prepared.promptMessages).toHaveLength(2)
    expect(JSON.stringify(prepared.promptMessages)).toContain('persisted attachment text')
    expect(JSON.stringify(prepared.coreMessages)).toContain('"image":"aGVsbG8="')
    expect(JSON.stringify(prepared.coreMessages)).toContain('"mediaType":"image/png"')
    expect(request.attachments.read).toHaveBeenCalledWith('file-key')
    expect(request.attachments.read).toHaveBeenCalledWith('image-key')
  })

  it('injects host tool instructions into the system prompt', async () => {
    const preparation = new BasicGenerationPreparation<TestContext>({
      prepareTools: () => Promise.resolve({ tools: {}, instructions: 'Native tool instructions' }),
    })

    const prepared = await preparation.prepare(createRequest())

    expect(prepared.promptMessages[0].role).toBe('system')
    expect(JSON.stringify(prepared.promptMessages[0].contentParts)).toContain('Native tool instructions')
    expect(JSON.stringify(prepared.promptMessages[0].contentParts)).toContain('Original system prompt')
  })

  it('coerces system messages for models that do not accept a system role', async () => {
    const prepared = await new BasicGenerationPreparation<TestContext>().prepare(
      createRequest(createModel({ system: false }))
    )

    expect(prepared.promptMessages[0].role).toBe('user')
    expect(prepared.coreMessages[0].role).toBe('user')
  })
})
