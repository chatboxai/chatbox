import { describe, expect, it, vi } from 'vitest'
import { LocalWorkMode } from './LocalWorkMode'
import { MobileExecutionService } from './MobileExecutionService'
import { base64ToText, type WorkspaceFiles } from './workspace-path'

describe('parse_file', () => {
  it('stores full text in workspace and returns only a compact reference without loading a skill', async () => {
    const files: WorkspaceFiles = { 'input/report.pdf': { base64: 'UEs=' } }
    const execution = new MobileExecutionService()
    const local = vi.spyOn(execution, 'parseDocument')
    const parser = { parse: vi.fn().mockResolvedValue({ text: 'long document '.repeat(2000), truncated: true }) }
    const mode = new LocalWorkMode(
      {
        snapshot: async () => files,
        readBase64: async (_session, path) => files[path].base64,
        readText: async () => '',
        commit: async (_session, changes) => {
          Object.assign(files, changes)
        },
        deliver: vi.fn(),
      },
      execution,
      undefined,
      undefined,
      undefined,
      parser
    )
    const { tools, active } = await mode.createTools({
      sessionId: 's',
      signal: new AbortController().signal,
      modelName: 'test',
    })
    expect(active.has('parse_file')).toBe(true)
    const output = await tools.parse_file.execute?.(
      { path: 'input/report.pdf' },
      { toolCallId: 'p', messages: [], context: undefined }
    )
    expect(output).toMatchObject({ truncated: true })
    expect(parser.parse).toHaveBeenCalledWith('input/report.pdf', 'UEs=', expect.any(AbortSignal))
    expect(local).not.toHaveBeenCalled()
    expect(JSON.stringify(output).length).toBeLessThan(800)
    const result = output as { path: string }
    expect(base64ToText(files[result.path].base64)).toContain('long document '.repeat(2000))
    expect(base64ToText(files[result.path].base64)).toContain('truncated')
  })
  it('handles parsing jobs with bounded outputs and rejects missing parser results', async () => {
    const service = new MobileExecutionService()
    const promise = service.parseDocument('test.docx', 'UEs=', new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    const job = service.getSnapshot()!
    expect(job.documentName).toBe('test.docx')
    expect(job.code).toBe('')
    service.receive(job.id, { stdout: '', files: {} })
    await expect(promise).rejects.toThrow('no content')
  })

  it('does not commit a parser result that arrives after cancellation', async () => {
    const controller = new AbortController()
    const commit = vi.fn()
    const mode = new LocalWorkMode(
      {
        snapshot: async () => ({}),
        readBase64: async () => 'UEs=',
        readText: async () => '',
        commit,
        deliver: vi.fn(),
      },
      new MobileExecutionService(),
      undefined,
      undefined,
      undefined,
      {
        parse: async () => {
          controller.abort(new Error('Stopped during parsing'))
          return { text: 'Late cloud text', truncated: false }
        },
      }
    )
    const { tools } = await mode.createTools({ sessionId: 's', signal: controller.signal, modelName: 'test' })
    await expect(
      tools.parse_file.execute?.({ path: 'input/report.doc' }, { toolCallId: 'p', messages: [], context: undefined })
    ).rejects.toThrow('Stopped during parsing')
    expect(commit).not.toHaveBeenCalled()
  })
})
