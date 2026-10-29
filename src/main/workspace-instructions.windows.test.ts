import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isSameFileIdentity, loadWorkspaceInstructions } from './workspace-instructions'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn() } }))

describe.skipIf(process.platform !== 'win32')('workspace instructions on native Windows', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'chatbox workspace instructions 中文-'))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  test('matches the path stat and handle stat of the same file', async () => {
    const filePath = path.join(workspace, 'AGENTS.md')
    writeFileSync(filePath, 'Follow the workspace rules.')

    const fileHandle = await open(filePath, 'r')
    try {
      const handleStat = await fileHandle.stat()
      const pathStat = await stat(filePath)

      expect(isSameFileIdentity(pathStat, handleStat)).toBe(true)
    } finally {
      await fileHandle.close()
    }
  })

  test('loads AGENTS.md from a workspace directory', async () => {
    writeFileSync(path.join(workspace, 'AGENTS.md'), 'Follow the workspace rules.')

    const result = await loadWorkspaceInstructions([workspace])

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({ content: 'Follow the workspace rules.', truncated: false })
  })
})
