import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import fileToolSet from '../../../src/renderer/packages/model-calls/toolsets/file'
import platform from '../../../src/renderer/platform'

type ToolExecutor = (input: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>

const readFile = fileToolSet.tools.read_file.execute as ToolExecutor
const searchFile = fileToolSet.tools.search_file_content.execute as ToolExecutor
const executeOptions = { toolCallId: 'integration-test', messages: [] }
const fixtureRoot = path.resolve(process.cwd(), 'test/cases/file-conversation')

async function loadFixture(name: string, key = name): Promise<string> {
  const content = fs.readFileSync(path.join(fixtureRoot, name), 'utf8')
  await platform.setStoreBlob(key, content)
  return key
}

describe('file conversation tools', () => {
  beforeEach(async () => {
    for (const key of await platform.listStoreBlobKeys()) await platform.delStoreBlob(key)
  })

  it('reads a selected range with stable one-based line numbers', async () => {
    const key = await loadFixture('sample-large.txt')

    const result = await readFile({ fileKey: key, lineOffset: 599, maxLines: 3 }, executeOptions)

    expect(result).toMatchObject({ fileKey: key, lineOffset: 599, linesRead: 3 })
    expect((result as { content: string }).content).toMatch(/^\s*600\t/m)
    expect((result as { content: string }).content).toMatch(/^\s*602\t/m)
  })

  it('returns all lines when the requested range extends beyond the file', async () => {
    const key = await loadFixture('sample.txt')
    const source = fs.readFileSync(path.join(fixtureRoot, 'sample.txt'), 'utf8')

    const result = await readFile({ fileKey: key, lineOffset: 0, maxLines: 1000 }, executeOptions)

    expect(result).toMatchObject({ linesRead: source.split('\n').length, totalLines: source.split('\n').length })
    expect((result as { content: string }).content).toContain('12345')
  })

  it('searches exact text and includes bounded surrounding context', async () => {
    const key = await loadFixture('sample.md')

    const result = (await searchFile(
      { fileKey: key, query: 'RATE_LIMITED', beforeContextLines: 1, afterContextLines: 1, maxResults: 5 },
      executeOptions
    )) as { results: Array<{ lineNumber: number; lineContent: string; context: string[] }>; totalMatches: number }

    expect(result.totalMatches).toBeGreaterThan(0)
    expect(result.results[0].lineContent).toContain('RATE_LIMITED')
    expect(result.results[0].context.length).toBeLessThanOrEqual(3)
    expect(result.results[0].lineNumber).toBeGreaterThan(0)
  })

  it('honors maxResults for repeated matches', async () => {
    await platform.setStoreBlob('repeated', ['needle one', 'needle two', 'needle three'].join('\n'))

    const result = (await searchFile({ fileKey: 'repeated', query: 'needle', maxResults: 2 }, executeOptions)) as {
      results: unknown[]
      totalMatches: number
    }

    expect(result.results).toHaveLength(2)
    expect(result.totalMatches).toBe(2)
  })

  it('throws a safe error message for inaccessible keys', async () => {
    // Tool infrastructure failures throw — the AI SDK forwards the message to the
    // model as a tool-error part (FABLE §6.3). The message must stay free of
    // internal details (no paths, no store internals).
    await expect(readFile({ fileKey: 'missing' }, executeOptions)).rejects.toThrow(
      'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
    )
    await expect(searchFile({ fileKey: 'missing', query: 'needle' }, executeOptions)).rejects.toThrow(
      'File not found or inaccessible. Ensure the fileKey is the correct identifier within <FILE_KEY> tags.'
    )
  })

  it('truncates pathological individual lines while preserving later lines', async () => {
    await platform.setStoreBlob('long-line', `${'x'.repeat(2500)}\nafter`)

    const result = (await readFile({ fileKey: 'long-line', maxLines: 2 }, executeOptions)) as { content: string }
    const lines = result.content.split('\n')

    expect(lines[0]).toHaveLength(6 + 1 + 2000)
    expect(lines[0].endsWith('...')).toBe(true)
    expect(lines[1].endsWith('\tafter')).toBe(true)
  })
})
