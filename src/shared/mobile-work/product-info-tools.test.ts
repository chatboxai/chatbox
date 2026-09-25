import { Theme, type Session } from '@chatbox/core'
import { createDefaultSettings } from '@chatbox/core/domain/settings'
import { describe, expect, it, vi } from 'vitest'
import { buildMobileProductInfoTool, type MobileProductInfoHost } from './product-info-tools'

function fixture() {
  const settings = {
    ...createDefaultSettings(),
    licenseKey: 'secret-license',
    providers: { openai: { apiKey: 'secret-api-key' } },
  }
  const session: Session = {
    id: 'one',
    name: 'Example',
    messages: [
      { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'secret-system' }] },
      { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello '.repeat(300) }] },
      { id: 'assistant', role: 'assistant', contentParts: [{ type: 'text', text: 'hello again' }] },
    ],
  }
  const host: MobileProductInfoHost = {
    getSettings: () => settings,
    refreshAccount: vi.fn(async () => true),
    getVersion: async () => ({ installedVersion: '1.0', platform: 'ios' }),
    listChats: vi.fn(async (cursor) => ({
      items: cursor === 0 ? [{ id: session.id, name: session.name, createdAt: 0, sortOrder: 0 }] : [],
      total: 1,
      nextCursor: null,
    })),
    getChat: vi.fn(async (id) => (id === session.id ? session : null)),
  }
  const controller = new AbortController()
  const cli = buildMobileProductInfoTool(host, controller.signal)
  const run = (argv: string[]) => cli.execute?.({ argv }, { toolCallId: 'test', messages: [], context: {} })
  return { host, controller, run, settings }
}

describe('mobile product info CLI', () => {
  it('exposes bounded read-only commands and never serializes credentials', async () => {
    const { run } = fixture()
    expect(await run(['capabilities'])).toMatchObject({ imageGeneration: false, readOnly: true })
    const output = JSON.stringify(await run(['account', 'status'])) + JSON.stringify(await run(['settings', 'list']))
    expect(output).not.toContain('secret-license')
    expect(output).not.toContain('secret-api-key')
    expect(await run(['settings', 'get', 'licenseKey'])).toHaveProperty('error')
    expect(await run(['settings', 'set', 'chat.stream', 'false'])).toHaveProperty('error')
    expect(await run(['image', 'generate'])).toHaveProperty('error')
    expect(await run(['settings', 'get', 'chat.stream'])).toMatchObject({ readOnly: true, value: true })
  })
  it('refreshes only on explicit command and contains remote errors', async () => {
    const { run, host } = fixture()
    await run(['account', 'quota'])
    expect(host.refreshAccount).not.toHaveBeenCalled()
    expect(await run(['account', 'refresh'])).toMatchObject({ refreshed: true, cached: false })
    vi.mocked(host.refreshAccount).mockRejectedValue(new Error('secret-server-response'))
    expect(JSON.stringify(await run(['account', 'refresh']))).not.toContain('secret-server-response')
  })
  it('paginates readable messages and search matches without exposing system messages', async () => {
    const { run } = fixture()
    const first = await run(['chats', 'read', 'one', '--limit', '1'])
    expect(first).toMatchObject({ nextCursor: 1, total: 2, messages: [{ messageId: 'user', truncated: true }] })
    expect(JSON.stringify(first)).not.toContain('secret-system')
    expect(await run(['chats', 'search', 'hello', '--limit', '1'])).toMatchObject({
      nextCursor: '0:1',
      hits: [{ messageId: 'user' }],
    })
    expect(await run(['chats', 'search', 'hello', '--limit', '1', '--cursor', '0:1'])).toMatchObject({
      hits: [{ messageId: 'assistant' }],
    })
    expect(await run(['chats', 'read', 'missing'])).toHaveProperty('error')
  })
  it('forwards archive selection and rejects invalid pagination', async () => {
    const { run, host } = fixture()
    await run(['chats', 'list', '--archived', '--limit', '3'])
    expect(host.listChats).toHaveBeenCalledWith(0, 3, true)
    for (const argv of [
      ['chats', 'list', '--limit', '0'],
      ['chats', 'list', '--limit', '21'],
      ['chats', 'list', '--cursor', '-1'],
      ['chats', 'search', 'hello', '--cursor', 'bad'],
      ['chats', 'list', '--unknown'],
    ]) {
      expect(await run(argv)).toHaveProperty('error')
    }
  })
  it('stops before accessing storage on cancellation', async () => {
    const { run, host, controller } = fixture()
    controller.abort()
    await expect(run(['chats', 'list'])).rejects.toThrow()
    expect(host.listChats).not.toHaveBeenCalled()
  })
})

it('bounds a search to 20 conversations and returns a resumable cursor even without matches', async () => {
  const { run, host } = fixture()
  vi.mocked(host.listChats).mockImplementation(async (cursor) => ({
    items: [{ id: 'one', name: 'Example', createdAt: 0, sortOrder: cursor }],
    total: 30,
    nextCursor: cursor + 1 < 30 ? cursor + 1 : null,
  }))
  expect(await run(['chats', 'search', 'no match'])).toMatchObject({ hits: [], nextCursor: '20:0' })
  expect(host.getChat).toHaveBeenCalledTimes(20)
  expect(await run(['chats', 'search', 'no match', '--cursor', '20:0'])).toMatchObject({ hits: [], nextCursor: null })
  expect(host.getChat).toHaveBeenCalledTimes(30)
})

it.each([
  [Theme.Dark, 'dark'],
  [Theme.Light, 'light'],
  [Theme.System, 'system'],
] as const)('returns a semantic theme name for theme %s', async (theme, expected) => {
  const { run, settings } = fixture()
  settings.theme = theme
  expect(await run(['settings', 'get', 'appearance.theme'])).toMatchObject({ value: expected })
  expect(await run(['settings', 'list'])).toMatchObject({
    items: expect.arrayContaining([{ key: 'appearance.theme', value: expected }]),
  })
})

it('dispatches supported image commands with execution identity and cancellation', async () => {
  const { host, controller } = fixture()
  const execute = vi.fn(async () => ({ kind: 'image-generation', recordId: 'image-1' }))
  host.imageCommands = { execute }
  const cli = buildMobileProductInfoTool(host, controller.signal, 'session-1')
  const options = { toolCallId: 'tool-1', messages: [], context: {} }
  expect(await cli.execute?.({ argv: ['capabilities'] }, options)).toMatchObject({
    imageGeneration: true,
    readOnly: false,
  })
  await cli.execute?.({ argv: ['image', 'generate', '--prompt', 'poster'] }, options)
  expect(execute).toHaveBeenCalledWith(['generate', '--prompt', 'poster'], {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    signal: controller.signal,
  })
})
