import { createMCPController, getBuiltinServerConfig, prepareRemoteMCPTools } from '@chatbox/core/mcp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMobileMcpFixture } from '../../../scripts/mobile-mcp-fixture.mjs'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

async function setup(path: string, protocolMode: 'auto' | 'legacy', fetchImpl = globalThis.fetch) {
  const fixture = createMobileMcpFixture()
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve))
  const address = fixture.server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture not listening')
  disposers.push(async () => {
    fixture.server.closeAllConnections()
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  })
  const controller = createMCPController({ mobile: true, fetch: fetchImpl })
  disposers.push(async () => {
    await Promise.all([...controller.servers.keys()].map((id) => controller.stopServer(id)))
  })
  const config = {
    id: 'remote',
    name: 'Remote',
    enabled: true,
    protocolMode,
    transport: { type: 'http' as const, url: `http://127.0.0.1:${address.port}/${path}` },
  }
  return { fixture, controller, config }
}

describe('host-independent MCP', () => {
  for (const [path, mode] of [
    ['modern', 'auto'],
    ['mcp', 'auto'],
    ['mcp', 'legacy'],
    ['sse', 'auto'],
    ['sse', 'legacy'],
  ] as const) {
    it(`executes a tool over ${mode} ${path}`, async () => {
      const { controller, config } = await setup(path, mode)
      const prepared = await prepareRemoteMCPTools({
        controller,
        enabled: true,
        model: { isSupportToolUse: () => true },
        settings: { mcp: { servers: [config], enabledBuiltinServers: [] } },
        signal: new AbortController().signal,
      })
      expect(prepared.unavailable).toEqual([])
      const result = await prepared.tools.mcp__remote__echo.execute?.(
        { text: '共享 MCP' },
        { toolCallId: 'call', messages: [] }
      )
      expect(result).toMatchObject({ content: [{ type: 'text', text: '共享 MCP' }], isError: false })
      expect(createMCPController({ mobile: true, fetch }).servers.size).toBe(0)
    })
  }
  it('constructs builtin credentials only from its host input', () => {
    expect(getBuiltinServerConfig('fetch')?.transport).toMatchObject({ headers: undefined })
    expect(getBuiltinServerConfig('fetch', 'synthetic')?.transport).toMatchObject({
      headers: { 'x-chatbox-license': 'synthetic' },
    })
  })
})

for (const [path, mode] of [
  ['modern', 'auto'],
  ['mcp', 'auto'],
  ['mcp', 'legacy'],
  ['sse', 'auto'],
  ['sse', 'legacy'],
] as const) {
  it(`cancels a pending ${mode} ${path} call without replaying it`, async () => {
    const { fixture, controller, config } = await setup(path, mode)
    await controller.startServer(config)
    const abort = new AbortController()
    const call = controller
      .getAvailableTools()
      .mcp__remote__echo.execute?.({ text: 'wait' }, { toolCallId: 'pending', messages: [], abortSignal: abort.signal })
    await vi.waitFor(() => expect(fixture.events.some((event: { pending?: boolean }) => event.pending)).toBe(true))
    abort.abort()
    expect(await call).toMatchObject({ isError: true })
    await vi.waitFor(() =>
      expect(fixture.events.some((event: { pendingClosed?: boolean }) => event.pendingClosed)).toBe(true)
    )
    expect(fixture.events.filter((event: { rpc?: string }) => event.rpc === 'tools/call')).toHaveLength(1)
    if (path !== 'modern') expect(controller.getServer(config.id)?.status.state).toBe('idle')
    await controller.startServer(config)
    expect(
      await controller
        .getAvailableTools()
        .mcp__remote__echo.execute?.({ text: 'explicit retry' }, { toolCallId: 'retry', messages: [] })
    ).toMatchObject({ isError: false })
  })
}

it('isolates third-party headers from builtin license credentials', async () => {
  const { config } = await setup('mcp', 'auto')
  const headers: Headers[] = []
  const controller = createMCPController({
    mobile: true,
    fetch: (input, init) => {
      headers.push(new Headers(init?.headers))
      return fetch(input, init)
    },
  })
  disposers.push(async () => {
    await controller.stopServer(config.id)
  })
  await prepareRemoteMCPTools({
    controller,
    enabled: true,
    model: { isSupportToolUse: () => true },
    settings: {
      licenseKey: 'synthetic-license',
      mcp: {
        servers: [{ ...config, transport: { ...config.transport, headers: { Authorization: 'Bearer third-party' } } }],
        enabledBuiltinServers: [],
      },
    },
    signal: new AbortController().signal,
  })
  expect(headers.length).toBeGreaterThan(0)
  expect(headers.every((header) => header.get('x-chatbox-license') === null)).toBe(true)
  expect(headers.some((header) => header.get('authorization') === 'Bearer third-party')).toBe(true)
})

it('times out discovery and ignores a late connection result', async () => {
  const { controller, config } = await setup('hang', 'auto')
  await controller.startServer(config, { timeoutMs: 30 })
  expect(controller.getServer(config.id)?.status).toMatchObject({
    state: 'idle',
    error: expect.stringContaining('timed out'),
  })
  expect(controller.getAvailableTools()).toEqual({})
})

it.each(['auto', 'legacy'] as const)(
  'does not send a tool call for an already-aborted native signal over %s',
  async (mode) => {
    const { fixture, controller, config } = await setup(mode === 'auto' ? 'modern' : 'mcp', mode)
    await controller.startServer(config)
    const abort = new AbortController()
    abort.abort()
    Object.defineProperties(abort.signal, {
      reason: { value: undefined },
      throwIfAborted: { value: undefined },
    })
    const result = await controller
      .getAvailableTools()
      .mcp__remote__echo.execute?.(
        { text: 'cancelled' },
        { toolCallId: 'cancelled', messages: [], abortSignal: abort.signal }
      )
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Aborted' }] })
    expect(fixture.events.filter((event: { rpc?: string }) => event.rpc === 'tools/call')).toHaveLength(0)
  }
)

for (const mode of ['auto', 'legacy'] as const) {
  it.each([0, 1])(
    `keeps the other generation's MCP tools when caller %s cancels ${mode} startup`,
    async (cancelledIndex) => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const fetchImpl: typeof fetch = async (input, init) => {
        await gate
        return fetch(input, init)
      }
      const { controller, config } = await setup(mode === 'auto' ? 'modern' : 'mcp', mode, fetchImpl)
      const options = {
        controller,
        enabled: true,
        model: { isSupportToolUse: () => true },
        settings: { mcp: { servers: [config], enabledBuiltinServers: [] } },
      }
      const signals = [new AbortController(), new AbortController()]
      const preparations = signals.map((abort) => prepareRemoteMCPTools({ ...options, signal: abort.signal }))
      const cancelled = expect(preparations[cancelledIndex]).rejects.toMatchObject({ name: 'AbortError' })
      signals[cancelledIndex].abort()
      try {
        await cancelled
        expect(controller.getServer(config.id)?.status.state).toBe('starting')
        release()
        const prepared = await preparations[1 - cancelledIndex]
        expect(prepared.unavailable).toEqual([])
        expect(
          await prepared.tools.mcp__remote__echo.execute?.(
            { text: 'survivor' },
            { toolCallId: 'survivor', messages: [] }
          )
        ).toMatchObject({ content: [{ type: 'text', text: 'survivor' }], isError: false })
      } finally {
        release()
      }
    }
  )

  it(`closes an abandoned ${mode} startup and permits an immediate retry`, async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pendingSignal: AbortSignal | null | undefined
    let requests = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      if (++requests === 1) {
        pendingSignal = init?.signal
        await gate
      }
      return fetch(input, init)
    }
    const { controller, config } = await setup(mode === 'auto' ? 'modern' : 'mcp', mode, fetchImpl)
    const options = {
      controller,
      enabled: true,
      model: { isSupportToolUse: () => true },
      settings: { mcp: { servers: [config], enabledBuiltinServers: [] } },
    }
    const signals = [new AbortController(), new AbortController()]
    const results = signals.map((abort) =>
      expect(prepareRemoteMCPTools({ ...options, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    )
    try {
      await vi.waitFor(() => expect(pendingSignal).toBeTruthy())
      signals.forEach((abort) => abort.abort())
      await Promise.all(results)
      await vi.waitFor(() => expect(pendingSignal?.aborted).toBe(true))
      const prepared = await prepareRemoteMCPTools({ ...options, signal: new AbortController().signal })
      expect(prepared.unavailable).toEqual([])
      release()
      await vi.waitFor(() => expect(controller.getServer(config.id)?.status.state).toBe('running'))
      expect(
        await prepared.tools.mcp__remote__echo.execute?.({ text: 'retry' }, { toolCallId: 'retry', messages: [] })
      ).toMatchObject({ isError: false })
    } finally {
      release()
    }
  })
}
