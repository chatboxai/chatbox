import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { scanLocalMemoryCandidates } from './local-memory-scanner'

const temporaryDirectories: string[] = []

async function createHome(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbox-memory-scan-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('scanLocalMemoryCandidates', () => {
  test('finds Codex summary and Claude user instructions without scanning project memories', async () => {
    const home = await createHome()
    const codexDirectory = path.join(home, '.codex', 'memories')
    const claudeDirectory = path.join(home, '.claude')
    const claudeRulesDirectory = path.join(claudeDirectory, 'rules', 'workflows')
    const claudeProjectMemoryDirectory = path.join(claudeDirectory, 'projects', 'workspace-one', 'memory')
    await Promise.all([
      fs.mkdir(codexDirectory, { recursive: true }),
      fs.mkdir(claudeRulesDirectory, { recursive: true }),
      fs.mkdir(claudeProjectMemoryDirectory, { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(
        path.join(codexDirectory, 'memory_summary.md'),
        "v1\n\n## User preferences\n\n- Prefer focused verification.\n\n## What's in Memory\n\n- Do not import routing.\n"
      ),
      fs.writeFile(path.join(claudeDirectory, 'CLAUDE.md'), '# Preferences\n\n- Keep replies concise.\n'),
      fs.writeFile(path.join(claudeRulesDirectory, 'verification.md'), '- Verify live state before reporting.\n'),
      fs.writeFile(
        path.join(claudeProjectMemoryDirectory, 'MEMORY.md'),
        '- This project memory must not be imported globally.\n'
      ),
    ])

    const result = await scanLocalMemoryCandidates(home)

    expect(result.skippedFiles).toBe(0)
    expect(result.candidates.map(({ source, displayPath, content }) => ({ source, displayPath, content }))).toEqual([
      {
        source: 'codex',
        displayPath: path.join('~', '.codex', 'memories', 'memory_summary.md'),
        content: 'Prefer focused verification.',
      },
      {
        source: 'claude',
        displayPath: path.join('~', '.claude', 'CLAUDE.md'),
        content: 'Keep replies concise.',
      },
      {
        source: 'claude',
        displayPath: path.join('~', '.claude', 'rules', 'workflows', 'verification.md'),
        content: 'Verify live state before reporting.',
      },
    ])
  })

  test('deduplicates identical memories found in multiple tools', async () => {
    const home = await createHome()
    const codexDirectory = path.join(home, '.codex', 'memories')
    const claudeDirectory = path.join(home, '.claude')
    await Promise.all([fs.mkdir(codexDirectory, { recursive: true }), fs.mkdir(claudeDirectory, { recursive: true })])
    await Promise.all([
      fs.writeFile(path.join(codexDirectory, 'memory_summary.md'), '- Shared preference.\n'),
      fs.writeFile(path.join(claudeDirectory, 'CLAUDE.md'), '- Shared preference.\n'),
    ])

    const result = await scanLocalMemoryCandidates(home)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].source).toBe('codex')
  })
})
