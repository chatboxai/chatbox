import { describe, expect, test } from 'vitest'
import { parseMemoryImport } from './memory-import'

describe('parseMemoryImport', () => {
  test('extracts Markdown bullets and paragraphs while ignoring scaffolding', () => {
    const result = parseMemoryImport(
      'CLAUDE.md',
      `# User preferences

- Prefer pnpm for this workspace.
- Keep progress updates concise.

Ask before public actions.

\`\`\`
secret example that is not a memory
\`\`\`
`
    )

    expect(result).toEqual({
      ok: true,
      entries: ['Prefer pnpm for this workspace.', 'Keep progress updates concise.', 'Ask before public actions.'],
    })
  })

  test('imports only the durable sections from a Codex memory summary', () => {
    const result = parseMemoryImport(
      'memory_summary.md',
      `v1

---
generated: true
---

## User Profile

Hands-on engineering lead.

## User preferences

- Prefer focused verification.

## What's in Memory

- Internal rollout routing that should not be imported.
`
    )

    expect(result).toEqual({
      ok: true,
      entries: ['Hands-on engineering lead.', 'Prefer focused verification.'],
    })
  })

  test('supports JSON strings and common memory object fields', () => {
    const result = parseMemoryImport(
      'memories.json',
      JSON.stringify({ memories: ['Use concise replies.', { content: 'Verify live state.' }, { memory: 'Use pnpm.' }] })
    )

    expect(result).toEqual({
      ok: true,
      entries: ['Use concise replies.', 'Verify live state.', 'Use pnpm.'],
    })
  })

  test('does not reinterpret ChatGPT conversation exports as memories', () => {
    const result = parseMemoryImport(
      'conversations.json',
      JSON.stringify([{ title: 'A chat', create_time: 1, mapping: { node: {} } }])
    )

    expect(result).toEqual({ ok: false, error: 'chat-history-not-supported' })
  })

  test('reports invalid JSON and empty supported files', () => {
    expect(parseMemoryImport('memories.json', '{')).toEqual({ ok: false, error: 'invalid-json' })
    expect(parseMemoryImport('MEMORY.md', '# Heading only')).toEqual({
      ok: false,
      error: 'no-supported-entries',
    })
  })
})
