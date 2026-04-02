import { describe, expect, it } from 'vitest'
import { createMainLangSmithAdapter } from './langsmith'

class FakeRunTree {
  static instances: FakeRunTree[] = []

  public readonly config: Record<string, unknown>
  public readonly child_runs: FakeRunTree[] = []
  public postRunCalls = 0
  public patchRunCalls = 0
  public endedWith:
    | {
        outputs?: Record<string, unknown>
        error?: string
        metadata?: Record<string, unknown>
      }
    | undefined

  constructor(config: Record<string, unknown>) {
    this.config = config
    FakeRunTree.instances.push(this)
  }

  async postRun() {
    this.postRunCalls += 1
  }

  async end(
    outputs?: Record<string, unknown>,
    error?: string,
    _endTime?: number,
    metadata?: Record<string, unknown>
  ) {
    this.endedWith = { outputs, error, metadata }
  }

  async patchRun() {
    this.patchRunCalls += 1
  }
}

describe('main LangSmith adapter', () => {
  it('creates parent and child runs and patches them on completion', async () => {
    FakeRunTree.instances.length = 0

    const adapter = createMainLangSmithAdapter({
      tracingEnabled: true,
      apiKey: 'test-key',
      projectName: 'chatbox-test',
      createRunTree: (config) => new FakeRunTree(config as unknown as Record<string, unknown>) as never,
      createId: () => `run-${FakeRunTree.instances.length + 1}`,
    })

    const parent = await adapter.startRun({
      name: 'chatbox.chat.generate',
      runType: 'chain',
      inputs: {
        prompt: 'Help me draft an opening statement for class.',
      },
      metadata: {
        sessionId: 'session-1',
      },
      tags: ['chatbox', 'renderer'],
    })

    const child = await adapter.startRun({
      name: 'model.chat',
      runType: 'llm',
      parentRunId: parent.runId,
      inputs: {
        apiKey: 'secret-key',
        image: 'data:image/png;base64,AAAA',
        text: 'x'.repeat(700),
      },
    })

    await child.end({
      outputs: {
        textPreview: 'Draft complete.',
      },
      metadata: {
        totalTokens: 42,
      },
    })
    await parent.end({
      outputs: {
        status: 'success',
      },
    })

    expect(FakeRunTree.instances).toHaveLength(2)
    expect(FakeRunTree.instances[0]?.config).toMatchObject({
      id: parent.runId,
      name: 'chatbox.chat.generate',
      run_type: 'chain',
      project_name: 'chatbox-test',
      tags: ['chatbox', 'renderer'],
      metadata: {
        sessionId: 'session-1',
      },
    })
    expect(FakeRunTree.instances[1]?.config).toMatchObject({
      id: child.runId,
      name: 'model.chat',
      run_type: 'llm',
      parent_run: FakeRunTree.instances[0],
    })
    expect(FakeRunTree.instances[1]?.config.inputs).toMatchObject({
      apiKey: '[redacted]',
      image: '[redacted-data-url]',
    })
    expect(String((FakeRunTree.instances[1]?.config.inputs as Record<string, unknown>).text)).toContain('…')
    expect(FakeRunTree.instances[0]?.postRunCalls).toBe(1)
    expect(FakeRunTree.instances[1]?.postRunCalls).toBe(1)
    expect(FakeRunTree.instances[0]?.patchRunCalls).toBe(1)
    expect(FakeRunTree.instances[1]?.patchRunCalls).toBe(1)
    expect(FakeRunTree.instances[1]?.endedWith).toEqual({
      outputs: {
        textPreview: 'Draft complete.',
      },
      error: undefined,
      metadata: {
        totalTokens: 42,
      },
    })
  })

  it('returns a noop handle when tracing is disabled', async () => {
    FakeRunTree.instances.length = 0

    const adapter = createMainLangSmithAdapter({
      tracingEnabled: false,
      apiKey: 'test-key',
      createRunTree: (config) => new FakeRunTree(config as unknown as Record<string, unknown>) as never,
    })

    const run = await adapter.startRun({
      name: 'disabled.trace',
      runType: 'chain',
    })
    await run.end({
      outputs: {
        ok: true,
      },
    })

    expect(FakeRunTree.instances).toHaveLength(0)
    expect(run.runId).toBeTruthy()
  })
})
