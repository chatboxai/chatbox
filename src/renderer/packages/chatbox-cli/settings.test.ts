import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => {
  const state = {
    theme: 2,
    language: 'en',
    fontSize: 14,
    spellCheck: true,
    stream: true as boolean | undefined,
    temperature: 0.7,
    maxContextMessageCount: 20,
    showWordCount: false,
    showTokenCount: false,
    showTokenUsed: true,
    showModelName: true,
    showMessageTimestamp: false,
    showAvatar: true,
    enableMarkdownRendering: true,
    enableLaTeXRendering: true,
    enableMermaidRendering: true,
    autoGenerateTitle: true,
    autoCompaction: true,
    autoLaunch: false,
    autoUpdate: true,
    betaUpdate: false,
    messageLayout: 'bubble',
    compactionThreshold: 0.6,
    startupPage: 'home',
  }
  return { state }
})

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => state },
}))

import { chatboxCliCommandCatalog } from './catalog'
import { executeChatboxCli } from './index'
import { parseArguments } from './parser'
import { settingsCommands } from './settings'
import type { ChatboxCliCommandContext } from './types'

function command(name: string) {
  const result = settingsCommands.find((candidate) => candidate.path[1] === name)
  if (!result) throw new Error(`Missing settings command: ${name}`)
  return result
}

function context(argv: string[]): ChatboxCliCommandContext {
  return {
    argv,
    parsed: parseArguments(argv),
    displayCommand: `chatbox settings ${argv.join(' ')}`,
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    approved: false,
  }
}

describe('Chatbox CLI settings allowlist', () => {
  beforeEach(() => {
    state.theme = 2
    state.stream = true
  })

  it('does not expose secret-bearing settings', async () => {
    const result = await command('list').execute(context([]))
    expect(JSON.stringify(result)).not.toContain('licenseKey')
    expect(JSON.stringify(result)).not.toContain('apiKey')
    expect(JSON.stringify(result)).not.toContain('mcp')
    expect(result).toMatchObject({
      readOnly: true,
      changeGuidance: expect.stringContaining('make changes manually'),
    })
  })

  it('rejects arbitrary setting paths', async () => {
    await expect(async () => command('get').execute(context(['licenseKey']))).rejects.toThrow(
      'Unknown or protected setting'
    )
  })

  it('only exposes read commands and guides manual changes to the correct page', async () => {
    expect(settingsCommands.map((candidate) => candidate.path)).toEqual([
      ['settings', 'list'],
      ['settings', 'get'],
    ])
    expect(
      chatboxCliCommandCatalog.filter((candidate) => candidate.domain === 'settings').map((candidate) => candidate.path)
    ).toEqual([
      ['settings', 'list'],
      ['settings', 'get'],
    ])
    expect(await command('get').execute(context(['appearance.theme']))).toMatchObject({
      readOnly: true,
      key: 'appearance.theme',
      value: 'system',
      location: 'Settings > Appearance',
      changeGuidance: expect.stringContaining('change this setting manually'),
    })
    expect(await command('get').execute(context(['appearance.spell-check']))).toMatchObject({
      location: 'Settings > Chat',
    })
  })

  it('reports the effective stream default and preserves an explicit opt-out', async () => {
    state.stream = undefined
    expect(await command('get').execute(context(['chat.stream']))).toMatchObject({ value: true })

    state.stream = false
    expect(await command('get').execute(context(['chat.stream']))).toMatchObject({ value: false })
  })

  it('rejects settings writes at the public CLI boundary', async () => {
    const result = await executeChatboxCli(
      { argv: ['settings', 'set', 'appearance.theme', 'dark'] },
      { toolCallId: 'tool-1', approved: true }
    )

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unsupported chatbox_cli command'),
      notes: expect.arrayContaining([expect.stringContaining('Settings access is read-only')]),
    })
    expect(state.theme).toBe(2)
  })
})
