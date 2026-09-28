import { lstatSync, mkdirSync, mkdtempSync, rmSync, type Stats, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WORKSPACE_INSTRUCTIONS_MAX_CHARS } from '../shared/types/workspace-instructions'
import { isSameFileIdentity, loadWorkspaceInstructions } from './workspace-instructions'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn() } }))

function fileIdentity(dev: number, ino: number): Stats {
  return { dev, ino } as Stats
}

const temporaryRoots: string[] = []

function createTemporaryRoot(): string {
  const root = mkdtempSync(path.join(process.cwd(), '.tmp-workspace-instructions-'))
  temporaryRoots.push(root)
  return root
}

function createWorkspace(root: string, name: string): string {
  const workspace = path.join(root, name)
  mkdirSync(workspace)
  return workspace
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('loadWorkspaceInstructions', () => {
  test('loads this repository canonical AGENTS.md as a regular file', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const instructionPath = path.join(repositoryRoot, 'AGENTS.md')

    const instructionStat = lstatSync(instructionPath)
    const result = await loadWorkspaceInstructions([repositoryRoot])

    expect(instructionStat.isFile()).toBe(true)
    expect(instructionStat.isSymbolicLink()).toBe(false)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filePath).toBe(instructionPath)
    expect(result.files[0].content).toContain('canonical instruction entrypoint')
  })

  test('reads a lowercase agents.md without truncating a long line', async () => {
    const root = createTemporaryRoot()
    const workspace = createWorkspace(root, 'workspace')
    const content = `${'a'.repeat(3_000)}\nKeep the final directive.`
    writeFileSync(path.join(workspace, 'agents.md'), content)

    const result = await loadWorkspaceInstructions([workspace])

    expect(result.files).toHaveLength(1)
    expect(result.files[0].filePath.toLowerCase()).toBe(path.join(workspace, 'agents.md').toLowerCase())
    expect(result.files[0]).toMatchObject({ content, truncated: false })
    expect(result.budgetExhausted).toBe(false)
  })

  test('shares one character budget across all workspace instruction files', async () => {
    const root = createTemporaryRoot()
    const firstWorkspace = createWorkspace(root, 'first')
    const secondWorkspace = createWorkspace(root, 'second')
    writeFileSync(path.join(firstWorkspace, 'AGENTS.md'), 'a'.repeat(60_000))
    writeFileSync(path.join(secondWorkspace, 'AGENTS.md'), 'b'.repeat(60_000))

    const result = await loadWorkspaceInstructions([firstWorkspace, secondWorkspace])

    expect(result.files).toHaveLength(2)
    expect(result.files.map((file) => file.content.length).reduce((sum, length) => sum + length, 0)).toBe(
      WORKSPACE_INSTRUCTIONS_MAX_CHARS
    )
    expect(result.files[0].truncated).toBe(false)
    expect(result.files[1].truncated).toBe(true)
    expect(result.budgetExhausted).toBe(true)
  })

  test.skipIf(process.platform === 'win32')(
    'rejects a symlinked AGENTS.md that points outside the workspace',
    async () => {
      const root = createTemporaryRoot()
      const workspace = createWorkspace(root, 'workspace')
      const secret = path.join(root, 'secret.txt')
      writeFileSync(secret, 'private-key-material')
      symlinkSync(secret, path.join(workspace, 'AGENTS.md'), 'file')

      const result = await loadWorkspaceInstructions([workspace])

      expect(result.files).toEqual([])
      expect(JSON.stringify(result)).not.toContain('private-key-material')
    }
  )

  test.skipIf(process.platform === 'win32')(
    'rejects a symlinked AGENTS.md whose target stays inside the workspace',
    async () => {
      const root = createTemporaryRoot()
      const workspace = createWorkspace(root, 'workspace')
      const instructionTarget = path.join(workspace, 'workspace-instructions.md')
      writeFileSync(instructionTarget, 'internal workspace instructions')
      symlinkSync(instructionTarget, path.join(workspace, 'AGENTS.md'), 'file')

      const result = await loadWorkspaceInstructions([workspace])

      expect(result.files).toEqual([])
      expect(JSON.stringify(result)).not.toContain('internal workspace instructions')
    }
  )

  test('rejects filesystem roots before reading instructions', async () => {
    const filesystemRoot = path.parse(process.cwd()).root

    const result = await loadWorkspaceInstructions([filesystemRoot])

    expect(result.directories).toEqual([])
    expect(result.files).toEqual([])
    expect(result.skippedDirectoryCount).toBe(1)
  })
})

describe('isSameFileIdentity', () => {
  test('matches a Windows path stat with st_dev 0 against the handle stat of the same file', () => {
    expect(
      isSameFileIdentity(fileIdentity(0, 34058472181999096), fileIdentity(752017921, 34058472181999096), 'win32')
    ).toBe(true)
  })

  test('rejects a different file ID on Windows', () => {
    expect(isSameFileIdentity(fileIdentity(0, 1), fileIdentity(752017921, 2), 'win32')).toBe(false)
  })

  test('rejects a missing file ID on Windows', () => {
    expect(isSameFileIdentity(fileIdentity(0, 0), fileIdentity(752017921, 0), 'win32')).toBe(false)
  })

  test('requires both device and inode to match on POSIX platforms', () => {
    expect(isSameFileIdentity(fileIdentity(1, 42), fileIdentity(1, 42), 'darwin')).toBe(true)
    expect(isSameFileIdentity(fileIdentity(1, 42), fileIdentity(2, 42), 'linux')).toBe(false)
    expect(isSameFileIdentity(fileIdentity(1, 42), fileIdentity(1, 43), 'darwin')).toBe(false)
  })
})
