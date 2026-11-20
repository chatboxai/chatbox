import { Button, Flex, Stack, Text, Group, Badge, TextInput, Collapse, ActionIcon, Tooltip, Alert } from '@mantine/core'
import { IconServer, IconPlus, IconSearch, IconChevronDown, IconChevronRight, IconClipboard, IconCheck } from '@tabler/icons-react'
import { useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'

export interface McpServerPreset {
    id: string
    name: string
    description: string
    category: string
    transport: 'stdio' | 'sse' | 'streamable-http'
    config: {
        command?: string
        args?: string[]
        url?: string
        env?: Record<string, string>
    }
    tags: string[]
    popularity: number
}

const MCP_SERVER_PRESETS: McpServerPreset[] = [
    {
        id: 'filesystem',
        name: 'Filesystem',
        description: 'Secure file operations with configurable access controls. Read, write, and manage files.',
        category: 'File & Storage',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'] },
        tags: ['files', 'storage', 'official'],
        popularity: 100,
    },
    {
        id: 'github',
        name: 'GitHub',
        description: 'Repository management, file operations, and GitHub API integration.',
        category: 'Development',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' } },
        tags: ['git', 'github', 'development', 'official'],
        popularity: 95,
    },
    {
        id: 'brave-search',
        name: 'Brave Search',
        description: 'Web and local search using Brave Search API.',
        category: 'Search & Web',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '<your-api-key>' } },
        tags: ['search', 'web', 'official'],
        popularity: 90,
    },
    {
        id: 'postgres',
        name: 'PostgreSQL',
        description: 'Read-only database access with schema inspection. Query PostgreSQL databases.',
        category: 'Database',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'] },
        tags: ['database', 'sql', 'postgres', 'official'],
        popularity: 85,
    },
    {
        id: 'sqlite',
        name: 'SQLite',
        description: 'Database interaction and business intelligence. Query and analyze SQLite databases.',
        category: 'Database',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/path/to/database.db'] },
        tags: ['database', 'sql', 'sqlite', 'official'],
        popularity: 85,
    },
    {
        id: 'memory',
        name: 'Memory (Knowledge Graph)',
        description: 'Persistent memory using a knowledge graph. Remember facts and relationships across sessions.',
        category: 'Knowledge',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
        tags: ['memory', 'knowledge', 'graph', 'official'],
        popularity: 80,
    },
    {
        id: 'puppeteer',
        name: 'Puppeteer',
        description: 'Browser automation and web scraping. Navigate pages, take screenshots, execute JavaScript.',
        category: 'Browser & Automation',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
        tags: ['browser', 'automation', 'scraping', 'official'],
        popularity: 80,
    },
    {
        id: 'fetch',
        name: 'Fetch',
        description: 'Web content fetching and conversion. Retrieve and process web pages.',
        category: 'Search & Web',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
        tags: ['web', 'fetch', 'http', 'official'],
        popularity: 75,
    },
    {
        id: 'everything',
        name: 'Everything (Reference)',
        description: 'Reference/test server with prompts, resources, and tools. Great for testing MCP clients.',
        category: 'Testing',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
        tags: ['test', 'reference', 'demo', 'official'],
        popularity: 60,
    },
    {
        id: 'sequential-thinking',
        name: 'Sequential Thinking',
        description: 'Dynamic problem-solving through thought sequences. Structured reasoning tool.',
        category: 'Reasoning',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
        tags: ['thinking', 'reasoning', 'official'],
        popularity: 70,
    },
    {
        id: 'mcp-installer',
        name: 'MCP Installer',
        description: 'Install and manage other MCP servers. One-click install from npm.',
        category: 'Utility',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', '@anaisbetts/mcp-installer'] },
        tags: ['installer', 'manager', 'utility'],
        popularity: 65,
    },
    {
        id: 'tavily',
        name: 'Tavily AI Search',
        description: 'AI-optimized web search via Tavily API.',
        category: 'Search & Web',
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', 'tavily-mcp@0.1.4'], env: { TAVILY_API_KEY: '<your-api-key>' } },
        tags: ['search', 'ai', 'web'],
        popularity: 75,
    },
]

const CATEGORIES = [...new Set(MCP_SERVER_PRESETS.map(p => p.category))].sort()

interface McpServerPresetsProps {
    onAddServer: (name: string, config: any) => void
    existingServerNames: string[]
}

export function McpServerPresets({ onAddServer, existingServerNames }: McpServerPresetsProps) {
    const { t } = useTranslation()
    const [search, setSearch] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    const filtered = useMemo(() => {
        return MCP_SERVER_PRESETS
            .filter(p => {
                if (selectedCategory && p.category !== selectedCategory) return false
                if (search) {
                    const q = search.toLowerCase()
                    return p.name.toLowerCase().includes(q)
                        || p.description.toLowerCase().includes(q)
                        || p.tags.some(t => t.includes(q))
                }
                return true
            })
            .sort((a, b) => b.popularity - a.popularity)
    }, [search, selectedCategory])

    const handleAdd = useCallback((preset: McpServerPreset) => {
        onAddServer(preset.name.toLowerCase().replace(/\s+/g, '-'), {
            transport: preset.transport,
            ...preset.config,
        })
    }, [onAddServer])

    const handleCopyConfig = useCallback((preset: McpServerPreset) => {
        const config = JSON.stringify({ [preset.name.toLowerCase().replace(/\s+/g, '-')]: {
            transport: preset.transport,
            ...preset.config,
        }}, null, 2)
        navigator.clipboard.writeText(config).then(() => {
            setCopiedId(preset.id)
            setTimeout(() => setCopiedId(null), 2000)
        })
    }, [])

    return (
        <Stack gap="md">
            <Flex justify="space-between" align="center">
                <Flex align="center" gap="xs">
                    <ScalableIcon icon={IconServer} size={18} />
                    <Text fw={600}>{t('MCP Server Presets')}</Text>
                    <Badge size="sm" variant="light">{MCP_SERVER_PRESETS.length}</Badge>
                </Flex>
            </Flex>

            <Text size="sm" c="chatbox-secondary">
                {t('Popular MCP servers you can add with one click. Requires Node.js (npx) to be installed.')}
            </Text>

            <TextInput
                placeholder={t('Search servers...')}
                leftSection={<ScalableIcon icon={IconSearch} size={16} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                size="sm"
            />

            <Flex gap="xs" wrap="wrap">
                <Badge
                    size="sm"
                    variant={selectedCategory === null ? 'filled' : 'light'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedCategory(null)}
                >
                    {t('All')}
                </Badge>
                {CATEGORIES.map(cat => (
                    <Badge
                        key={cat}
                        size="sm"
                        variant={selectedCategory === cat ? 'filled' : 'light'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    >
                        {cat}
                    </Badge>
                ))}
            </Flex>

            <Stack gap="xs" style={{ maxHeight: 400, overflow: 'auto' }}>
                {filtered.map((preset) => {
                    const isExpanded = expandedId === preset.id
                    const isAdded = existingServerNames.includes(preset.name.toLowerCase().replace(/\s+/g, '-'))
                    return (
                        <Stack key={preset.id} gap={0}
                            style={{
                                border: '1px solid var(--mantine-color-chatbox-border-secondary)',
                                borderRadius: 8,
                                overflow: 'hidden',
                            }}>
                            <Flex justify="space-between" align="center" p="sm"
                                style={{ cursor: 'pointer' }}
                                onClick={() => setExpandedId(isExpanded ? null : preset.id)}>
                                <Flex align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
                                    <ScalableIcon
                                        icon={isExpanded ? IconChevronDown : IconChevronRight}
                                        size={14}
                                        color="var(--mantine-color-chatbox-tertiary)"
                                    />
                                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                        <Flex align="center" gap="xs">
                                            <Text size="sm" fw={500}>{preset.name}</Text>
                                            <Badge size="xs" variant="outline" color="gray">{preset.transport}</Badge>
                                        </Flex>
                                        <Text size="xs" c="chatbox-tertiary" lineClamp={1}>{preset.description}</Text>
                                    </Stack>
                                </Flex>
                                <Flex gap="xs">
                                    <Tooltip label={t('Copy config')}>
                                        <ActionIcon variant="subtle" size="sm"
                                            onClick={(e) => { e.stopPropagation(); handleCopyConfig(preset) }}>
                                            <ScalableIcon
                                                icon={copiedId === preset.id ? IconCheck : IconClipboard}
                                                size={14}
                                                color={copiedId === preset.id ? 'var(--mantine-color-green-filled)' : undefined}
                                            />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Button
                                        variant="light"
                                        size="compact-xs"
                                        disabled={isAdded}
                                        leftSection={<ScalableIcon icon={IconPlus} size={12} />}
                                        onClick={(e) => { e.stopPropagation(); handleAdd(preset) }}
                                    >
                                        {isAdded ? t('Added') : t('Add')}
                                    </Button>
                                </Flex>
                            </Flex>
                            <Collapse in={isExpanded}>
                                <Stack gap="xs" px="sm" pb="sm"
                                    style={{ borderTop: '1px solid var(--mantine-color-chatbox-border-secondary)' }}>
                                    <Text size="xs" pt="sm">{preset.description}</Text>
                                    <Flex gap="xs" wrap="wrap">
                                        {preset.tags.map(tag => (
                                            <Badge key={tag} size="xs" variant="dot">{tag}</Badge>
                                        ))}
                                    </Flex>
                                    <Stack gap={2}>
                                        <Text size="xs" fw={500} c="chatbox-secondary">Config:</Text>
                                        <Text size="xs" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', backgroundColor: 'var(--mantine-color-default-hover)', padding: 4, borderRadius: 4 }}>
                                            {JSON.stringify(preset.config, null, 2)}
                                        </Text>
                                    </Stack>
                                </Stack>
                            </Collapse>
                        </Stack>
                    )
                })}
            </Stack>
        </Stack>
    )
}
