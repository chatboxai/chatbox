import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanupStaleCommandOutputCaptures,
  configureCommandOutputCaptureRoot,
  createCommandOutputCapture,
  createCommandOutputCapturePath,
  getCommandOutputCaptureRoot,
  MAX_COMMAND_OUTPUT_CAPTURE_BYTES,
} from './command-output-capture'

describe('createCommandOutputCapture', () => {
  it('uses the configured private application data directory', () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'chatbox-user-data-'))
    try {
      configureCommandOutputCaptureRoot(userDataPath)
      const outputPath = createCommandOutputCapturePath('../unsafe/tool')
      expect(path.dirname(outputPath)).toBe(getCommandOutputCaptureRoot())
      expect(outputPath.startsWith(userDataPath + path.sep)).toBe(true)
      expect(path.basename(outputPath)).not.toContain('..')
    } finally {
      configureCommandOutputCaptureRoot(tmpdir())
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('keeps every output byte on disk when the inline threshold is exceeded', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-'))
    const outputPath = path.join(root, 'output.txt')
    const capture = createCommandOutputCapture(outputPath)
    const stdout = Buffer.from('stdout-line\n'.repeat(1_000))
    const stderr = Buffer.from('stderr-line\n'.repeat(1_000))

    try {
      capture.append('stdout', stdout)
      capture.append('stderr', stderr)
      await expect(capture.finish()).resolves.toBe(outputPath)
      expect(statSync(outputPath).mode & 0o777).toBe(0o600)
      const stored = readFileSync(outputPath)
      expect(stored.includes(stdout)).toBe(true)
      expect(stored.includes(stderr)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes the capture file when the result fits inline', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-small-'))
    const outputPath = path.join(root, 'output.txt')
    const capture = createCommandOutputCapture(outputPath)

    try {
      capture.append('stdout', Buffer.from('small output'))
      await expect(capture.finish()).resolves.toBeUndefined()
      expect(existsSync(outputPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports capture file creation failures', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-failure-'))
    const capture = createCommandOutputCapture(root)

    try {
      await expect(capture.finish()).resolves.toBeUndefined()
      expect(capture.isFailed()).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('retains the file when one stream exceeds its inline preview budget', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-preview-'))
    const outputPath = path.join(root, 'output.txt')
    const capture = createCommandOutputCapture(outputPath)

    try {
      capture.append('stdout', Buffer.alloc(6_001, 'x'))
      await expect(capture.finish()).resolves.toBe(outputPath)
      expect(readFileSync(outputPath).includes(Buffer.alloc(6_001, 'x'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('signals backpressure and resumes producers after the file stream drains', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-drain-'))
    const outputPath = path.join(root, 'output.txt')
    const capture = createCommandOutputCapture(outputPath)

    try {
      expect(capture.append('stdout', Buffer.alloc(128 * 1024, 'x'))).toBe(false)
      await new Promise<void>((resolve) => capture.onDrain(resolve))
      await expect(capture.finish()).resolves.toBe(outputPath)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('caps capture files and reports that the producer must be terminated', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-limit-'))
    const outputPath = path.join(root, 'output.txt')
    const capture = createCommandOutputCapture(outputPath)

    try {
      capture.append('stdout', Buffer.alloc(MAX_COMMAND_OUTPUT_CAPTURE_BYTES + 1, 'x'))
      expect(capture.isLimitExceeded()).toBe(true)
      await expect(capture.finish()).resolves.toBe(outputPath)
      expect(statSync(outputPath).size).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_CAPTURE_BYTES)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reclaims retained captures after seven days', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-command-output-cleanup-'))
    const oldCapture = path.join(root, 'old.txt')
    const recentCapture = path.join(root, 'recent.txt')
    const now = Date.now()
    writeFileSync(oldCapture, 'old')
    writeFileSync(recentCapture, 'recent')
    utimesSync(oldCapture, new Date(now - 8 * 24 * 60 * 60 * 1000), new Date(now - 8 * 24 * 60 * 60 * 1000))

    try {
      cleanupStaleCommandOutputCaptures({ root, now })
      expect(existsSync(oldCapture)).toBe(false)
      expect(existsSync(recentCapture)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
