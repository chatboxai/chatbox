import http from 'node:http'
import { pathToFileURL } from 'node:url'

/** Local protocol fixture: deliberately sends no CORS headers. */
export function createMobileMcpFixture() {
  const events = []
  const reports = []
  const streams = new Map()
  let sequence = 0
  const record = (event) => events.push({ at: Date.now(), ...event })
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture.local')
      record({ method: req.method, path: url.pathname })
      if (url.pathname === '/reports' && req.method === 'GET') return json(res, 200, reports)
      if (url.pathname === '/stats') return json(res, 200, events)
      if (req.method === 'OPTIONS') return res.writeHead(403).end()
      if (url.pathname === '/report') {
        let body = ''
        for await (const part of req) body += part
        reports.push(JSON.parse(body))
        console.log(JSON.stringify({ report: reports.at(-1) }))
        return json(res, 200, { saved: true })
      }
      if (url.pathname === '/redirect') return res.writeHead(302, { location: '/redirect-sink' }).end()
      if (url.pathname === '/redirect-sink') return json(res, 200, { redirected: true })
      if (url.pathname.startsWith('/status/')) {
        const status = Number(url.pathname.split('/').at(-1))
        res.writeHead(status, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
        return res.end(status === 204 ? undefined : JSON.stringify({ status }))
      }
      if (url.pathname === '/hang') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(': waiting\n\n')
        res.on('close', () => record({ hangClosed: true }))
        return
      }
      if (url.pathname === '/split') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        for (const byte of Buffer.from('MCP 中文 ✅')) {
          if (res.destroyed) break
          res.write(Buffer.from([byte]))
          await new Promise((resolve) => setTimeout(resolve, 3))
        }
        return res.end()
      }
      if (url.pathname === '/sse' && req.method === 'GET') {
        const id = String(++sequence)
        streams.set(id, res)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`event: endpoint\ndata: /messages?session=${id}\n\n`)
        res.on('close', () => {
          streams.delete(id)
          record({ sseClosed: true, session: id })
        })
        return
      }
      if (url.pathname === '/sse') return res.writeHead(404).end()
      if (req.method === 'GET') return res.writeHead(405).end()
      if (req.method === 'DELETE') return res.writeHead(204).end()
      let raw = ''
      for await (const part of req) raw += part
      const message = JSON.parse(raw)
      record({ rpc: message.method, path: url.pathname })
      if (message.id === undefined) return res.writeHead(202).end()
      const modern = url.pathname === '/modern'
      let result
      if (message.method === 'server/discover') {
        if (!modern)
          return json(res, 200, {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Method not found' },
          })
        result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' }
      } else if (message.method === 'initialize') {
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'rn-mcp-fixture', version: '1.0.0' },
        }
      } else if (message.method === 'tools/list') {
        result = {
          tools: [
            {
              name: 'echo',
              description: 'Echo the supplied text',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            },
          ],
        }
      } else if (message.method === 'tools/call') {
        if (message.params.arguments.text === 'wait') {
          record({ pending: true })
          res.on('close', () => record({ pendingClosed: true }))
          return
        }
        result = { content: [{ type: 'text', text: message.params.arguments.text }], isError: false }
      } else
        return json(res, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
      if (modern)
        result = {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          ...result,
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'rn-mcp-fixture', version: '1.0.0' } },
        }
      const response = { jsonrpc: '2.0', id: message.id, result }
      if (url.pathname === '/messages') {
        const stream = streams.get(url.searchParams.get('session'))
        if (!stream) return res.writeHead(404).end()
        stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
        return res.writeHead(202).end()
      }
      return json(res, 200, response)
    } catch (error) {
      record({ error: error.message })
      if (!res.headersSent) json(res, 500, { error: 'Fixture request failed' })
      else res.end()
    }
  })
  return { server, events, reports }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createMobileMcpFixture()
  server.listen(Number(process.env.MCP_FIXTURE_PORT || 18766), '0.0.0.0', () =>
    console.log('MCP fixture listening', server.address().port)
  )
}
