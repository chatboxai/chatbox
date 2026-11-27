import type { MCPProtocolMode, MCPServerConfig } from './types'

export interface BuildinMCPServerConfig {
  id: string
  name: string
  description: string
  url: string
  /** Transport flavour: 'legacy' opens a GET SSE stream, 'auto' tries streamable HTTP first. */
  protocolMode?: MCPProtocolMode
  /** Served by the Chatbox AI proxy, which checks the license key before answering. */
  requiresLicense?: boolean
}

/**
 * The Chatbox AI proxy host. Only used by servers that are actually proxied by Chatbox AI
 * (`requiresLicense`), everything else points at a public MCP endpoint.
 */
const CHATBOX_AI_MCP_BASE_URL = 'https://mcp.chatboxai.app'

export const BUILTIN_MCP_SERVERS: BuildinMCPServerConfig[] = [
  {
    id: 'fetch',
    name: 'Fetch',
    description:
      'This server enables LLMs to retrieve and process content from web pages, converting HTML to markdown for easier consumption.',
    url: 'https://mcp.jina.ai/sse',
    protocolMode: 'auto',
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    description: 'MCP server for accessing arXiv papers. Needs a Chatbox AI license.',
    url: `${CHATBOX_AI_MCP_BASE_URL}/arxiv`,
    requiresLicense: true,
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Retrieves up-to-date documentation and code examples for any library.',
    url: 'https://mcp.context7.com/mcp',
    protocolMode: 'auto',
  },
]

/** Builtin servers that keep working after a license is removed. */
export const LICENSE_FREE_BUILTIN_SERVERS: string[] = BUILTIN_MCP_SERVERS.filter((s) => !s.requiresLicense).map(
  (s) => s.id
)

/**
 * The builtin servers an open build turns on out of the box. Settings store `[]` for profiles
 * that were created before these defaults existed, so an empty list also means "use the default".
 */
export const DEFAULT_ENABLED_BUILTIN_SERVERS: string[] = LICENSE_FREE_BUILTIN_SERVERS

export function getBuiltinServerConfig(id: string, licenseKey?: string): MCPServerConfig | null {
  const config = BUILTIN_MCP_SERVERS.find((s) => s.id === id)
  if (!config) {
    return null
  }
  const license = licenseKey
  return {
    id,
    name: config.name,
    enabled: true,
    protocolMode: config.protocolMode ?? 'legacy',
    transport: {
      type: 'http',
      url: config.url,
      headers: config.requiresLicense && license ? { 'x-chatbox-license': license } : undefined,
    },
  }
}
