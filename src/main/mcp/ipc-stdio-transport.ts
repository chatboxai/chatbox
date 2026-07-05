// 和 renderer/packages/mcp/ipc-stdio-transport.ts 配套的main进程ipc handler

import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import chardet from 'chardet'
import { BrowserWindow, ipcMain } from 'electron'
import iconv from 'iconv-lite'
import { isEmpty } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import {
  mcpStdioCreateMetaPayload,
  mcpStdioCreatePayload,
  mcpTransportIdPayload,
  parseIpcPayload,
} from '../ipc-payloads'
import { getLogger } from '../util'
import { ensureStdioServerApproved } from './approval-ledger'
import { shellEnv } from './shell-env'

async function enhanceEnv(configEnv?: Record<string, string>) {
  let env = await shellEnv().catch((err) => {
    logger.error('shell-env', err)
    return {}
  })
  if (configEnv) {
    env = { ...env, ...configEnv }
  }
  return isEmpty(env) ? undefined : env
}

const logger = getLogger('mcp:stdio-transport')

const transportMap = new Map<string, StdioClientTransport>()

function getTransport(transportId: string) {
  const transport = transportMap.get(transportId)
  if (!transport) {
    throw new Error(`Transport ${transportId} not found`)
  }
  return transport
}

ipcMain.handle(
  'mcp:stdio-transport:create',
  async (event, rawServerParams: StdioServerParameters, rawMeta?: { name?: string }) => {
    // §6.2: shape-validate before anything else — command/args/env feed both
    // the approval fingerprint and the spawn.
    const serverParams = parseIpcPayload('mcp:stdio-transport:create', mcpStdioCreatePayload, rawServerParams)
    const meta = parseIpcPayload('mcp:stdio-transport:create (meta)', mcpStdioCreateMetaPayload, rawMeta)
    logger.info('create', serverParams)

    // SEC-1: a stdio launch runs a local process with the user's permissions.
    // Because the renderer is untrusted, gate every launch on a native
    // approval whose fingerprint (command/args/env) isn't already trusted.
    const approved = await ensureStdioServerApproved(
      { command: serverParams.command, args: serverParams.args, env: serverParams.env },
      meta,
      BrowserWindow.fromWebContents(event.sender)
    )
    if (!approved) {
      throw new Error('MCP server launch was not approved by the user')
    }

    const postMessage = (channel: string, ...args: any[]) => {
      try {
        event.sender.send(channel, ...args)
      } catch (err) {
        logger.error('postMessage error', channel, err)
      }
    }

    const env = await enhanceEnv(serverParams.env)
    const transport = new StdioClientTransport({
      command: serverParams.command,
      args: serverParams.args,
      env,
      stderr: 'pipe',
    })

    let stderrMessage = ''
    transport.stderr?.addListener('data', (data: Buffer) => {
      const encoding = chardet.detect(new Uint8Array(data))
      const text = iconv.decode(data, encoding || 'utf-8')
      logger.debug('mcp stderr', text)
      stderrMessage += text
    })

    const transportId = uuidv4()
    transport.onclose = () => {
      logger.info('onclose', transportId)
      transport.stderr?.removeAllListeners()
      postMessage(`mcp:stdio-transport:${transportId}:onclose`, stderrMessage)
      transportMap.delete(transportId)
    }
    transport.onerror = (error) => {
      logger.error('onerror', transportId, error)
      postMessage(`mcp:stdio-transport:${transportId}:onerror`, error)
    }
    transport.onmessage = (message) => {
      logger.info('onmessage', transportId, message)
      postMessage(`mcp:stdio-transport:${transportId}:onmessage`, message)
    }
    transportMap.set(transportId, transport)
    return transportId
  }
)

ipcMain.handle('mcp:stdio-transport:start', async (_event, rawTransportId: string) => {
  const transportId = parseIpcPayload('mcp:stdio-transport:start', mcpTransportIdPayload, rawTransportId)
  logger.info('start', transportId)
  const transport = getTransport(transportId)
  await transport.start()
})

ipcMain.handle('mcp:stdio-transport:send', async (_event, rawTransportId: string, message: JSONRPCMessage) => {
  const transportId = parseIpcPayload('mcp:stdio-transport:send', mcpTransportIdPayload, rawTransportId)
  logger.info('send', transportId, message)
  const transport = getTransport(transportId)
  await transport.send(message)
})

ipcMain.handle('mcp:stdio-transport:close', async (_event, rawTransportId: string) => {
  const transportId = parseIpcPayload('mcp:stdio-transport:close', mcpTransportIdPayload, rawTransportId)
  logger.info('close', transportId)
  const transport = getTransport(transportId)
  await transport.close()
  transportMap.delete(transportId)
})

export function closeAllTransports() {
  for (const [id, transport] of transportMap.entries()) {
    transport.close().catch((err) => {
      logger.error('close stdio transport', id, err)
    })
  }
}
