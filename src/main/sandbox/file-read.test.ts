import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { buildSandboxReadScript, SANDBOX_READ_MAX_CONTENT_BYTES } from './file-read'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('buildSandboxReadScript', () => {
  test('reports shortened lines even at limit one and leaves their source recoverable', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chatbox-read-file-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'long.txt')
    const content = `${'教'.repeat(999)}😀${'教育𠀀'.repeat(700)}尾部知识点`
    writeFileSync(filePath, content)

    for (const limit of [500, 1]) {
      const script = buildSandboxReadScript({ filePath, startLine: 1, limit, maxLineLength: 2000 })
      const result = spawnSync(process.execPath, [], { input: script, encoding: 'utf8' })
      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output).toMatchObject({ startLine: 1, endLine: 1, totalLines: 1, truncatedLineCount: 1 })
      expect(output.content).toHaveLength(2000)
      expect(output.content).not.toContain('尾部知识点')
    }

    // Exercise the character-chunk recovery path with the same Node runtime used by code_execution.
    const chunks: string[] = []
    for (let offset = 0; offset < Array.from(content).length; offset += 1000) {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `const text = require('node:fs').readFileSync(process.argv[1], 'utf8'); process.stdout.write(Array.from(text).slice(Number(process.argv[2]), Number(process.argv[2]) + 1000).join(''))`,
          filePath,
          String(offset),
        ],
        { encoding: 'utf8' }
      )
      expect(result.status).toBe(0)
      chunks.push(result.stdout)
    }
    expect(chunks.join('')).toBe(content)
  })

  test('counts only shortened lines actually returned within the byte budget', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chatbox-read-file-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'long-lines.txt')
    writeFileSync(filePath, Array.from({ length: 100 }, () => 'x'.repeat(3000)).join('\n'))
    const result = spawnSync(process.execPath, [], {
      input: buildSandboxReadScript({ filePath, startLine: 1, limit: 100, maxLineLength: 2000 }),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.truncatedLineCount).toBe(output.endLine)
    expect(output.endLine).toBeLessThan(output.totalLines)
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThan(50 * 1024)
  })

  test('keeps encoded JSON below the exec output truncation threshold', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chatbox-read-file-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'large.txt')
    const line = `${'x'.repeat(900)}\t${'\\"'.repeat(40)}`
    writeFileSync(filePath, Array.from({ length: 100 }, () => line).join('\n'))

    const script = buildSandboxReadScript({ filePath, startLine: 1, limit: 100, maxLineLength: 2000 })
    const result = spawnSync(process.execPath, [], { input: script, encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThan(50 * 1024)
    const output = JSON.parse(result.stdout) as {
      content: string
      startLine: number
      endLine: number
      totalLines: number
    }
    expect(Buffer.byteLength(JSON.stringify(output.content), 'utf8') - 2).toBeLessThanOrEqual(
      SANDBOX_READ_MAX_CONTENT_BYTES
    )
    expect(output).toMatchObject({ startLine: 1, totalLines: 100 })
    expect(output.endLine).toBeGreaterThan(0)
    expect(output.endLine).toBeLessThan(output.totalLines)
  })

  test('preserves line pagination when content fits in the byte budget', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chatbox-read-file-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'small.txt')
    writeFileSync(filePath, 'alpha\nbeta\ngamma')

    const script = buildSandboxReadScript({ filePath, startLine: 2, limit: 1, maxLineLength: 2000 })
    const result = spawnSync(process.execPath, [], { input: script, encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      content: 'beta',
      startLine: 2,
      endLine: 2,
      totalLines: 3,
    })
  })
})
