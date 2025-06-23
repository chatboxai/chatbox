import { getLicenseKey } from '@/stores/settingActions'
import { MCPServerConfig } from './types'
import i18n from '@/i18n'

export interface BuildinMCPServerConfig {
  id: string
  name: string
  description: string
  url: string
}

export const BUILTIN_MCP_SERVERS: BuildinMCPServerConfig[] = [
  {
    id: 'fetch',
    name: 'Fetch',
    description: i18n.t(
      'This server enables LLMs to retrieve and process content from web pages, converting HTML to markdown for easier consumption.'
    ),
    url: 'https://mcp.chatboxai.app/fetch',
  },
  {
    id: 'sequentialthinking',
    name: 'Sequential Thinking',
    description: i18n.t(
      'An MCP server implementation that provides a tool for dynamic and reflective problem-solving through a structured thinking process.'
    ),
    url: 'https://mcp.chatboxai.app/sequentialthinking',
  },
  {
    id: 'edgeone-pages',
    name: 'EdgeOne Pages',
    description: i18n.t('Deploy HTML content to EdgeOne Pages and obtaining an accessible public URL.'),
    url: 'https://mcp.chatboxai.app/edgeone-pages',
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    description: i18n.t('MCP server for accessing arXiv papers'),
    url: 'https://mcp.chatboxai.app/arxiv',
  },
  {
    id: 'context7',
    name: 'Context7',
    description: i18n.t('Retrieves up-to-date documentation and code examples for any library.'),
    url: 'https://mcp.chatboxai.app/context7',
  },
]

export function getBuiltinServerConfig(id: string, licenseKey?: string): MCPServerConfig | null {
  const config = BUILTIN_MCP_SERVERS.find((s) => s.id === id)
  if (!config) {
    return null
  }
  const license = licenseKey || getLicenseKey()
  return {
    id,
    name: config.name,
    enabled: true,
    transport: {
      type: 'http',
      url: config.url,
      headers: license ? { 'x-chatbox-license': license } : undefined,
    },
  }
}
