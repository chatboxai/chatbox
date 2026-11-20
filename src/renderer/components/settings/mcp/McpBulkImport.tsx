import { Button, Stack, Text, Textarea, Alert, Group, Badge, Flex } from '@mantine/core'
import { IconUpload, IconServer } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'

interface McpBulkImportProps {
    opened: boolean
    onClose: () => void
    onImport: (servers: Record<string, any>) => void
    existingServerNames: string[]
}

export function McpBulkImport({ opened, onClose, onImport, existingServerNames }: McpBulkImportProps) {
    const { t } = useTranslation()
    const [input, setInput] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [parsedServers, setParsedServers] = useState<Record<string, any>>({})

    const handleParse = useCallback(() => {
        setError(null)
        try {
            const parsed = JSON.parse(input.trim())
            if (typeof parsed !== 'object' || parsed === null) {
                setError(t('Expected a JSON object with server names as keys'))
                return
            }
            // Validate each server config
            const valid: Record<string, any> = {}
            for (const [name, config] of Object.entries(parsed)) {
                if (typeof config !== 'object' || config === null) continue
                const cfg = config as any
                if (!cfg.transport || !['stdio', 'sse', 'streamable-http'].includes(cfg.transport)) continue
                if (cfg.transport === 'stdio' && !cfg.command) continue
                if ((cfg.transport === 'sse' || cfg.transport === 'streamable-http') && !cfg.url) continue
                valid[name] = cfg
            }
            if (Object.keys(valid).length === 0) {
                setError(t('No valid server configurations found'))
                return
            }
            setParsedServers(valid)
        } catch (e: any) {
            setError(t('Invalid JSON: {{error}}', { error: e.message }))
        }
    }, [input, t])

    const handleImport = useCallback(() => {
        const newServers: Record<string, any> = {}
        for (const [name, config] of Object.entries(parsedServers)) {
            if (!existingServerNames.includes(name)) {
                newServers[name] = config
            }
        }
        if (Object.keys(newServers).length > 0) {
            onImport(newServers)
        }
        setInput('')
        setParsedServers({})
        onClose()
    }, [parsedServers, existingServerNames, onImport, onClose])

    const serverNames = Object.keys(parsedServers)
    const newServers = serverNames.filter(n => !existingServerNames.includes(n))
    const duplicates = serverNames.filter(n => existingServerNames.includes(n))

    return (
        <AdaptiveModal
            opened={opened}
            onClose={() => { setInput(''); setParsedServers({}); setError(null); onClose() }}
            title={t('Import MCP Servers')}
            centered
            size="lg"
        >
            <Stack gap="md">
                <Text size="sm" c="chatbox-secondary">
                    {t('Paste a JSON object containing MCP server configurations. Keys are server names, values are server configs.')}
                </Text>

                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    placeholder={`{\n  "my-server": {\n    "transport": "stdio",\n    "command": "npx",\n    "args": ["-y", "@my-org/mcp-server"]\n  },\n  "remote-server": {\n    "transport": "sse",\n    "url": "http://localhost:3001/sse"\n  }\n}`}
                    minRows={8}
                    maxRows={16}
                    styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
                />

                <Button
                    variant="light"
                    onClick={handleParse}
                    disabled={!input.trim()}
                    leftSection={<ScalableIcon icon={IconUpload} size={16} />}
                    size="compact-sm"
                >
                    {t('Parse & Preview')}
                </Button>

                {error && <Alert color="red" variant="light">{error}</Alert>}

                {serverNames.length > 0 && (
                    <>
                        <Text size="sm" fw={600}>
                            {t('Preview')} ({newServers.length} {t('new')}, {duplicates.length} {t('duplicates')})
                        </Text>
                        <Stack gap="xs">
                            {serverNames.map(name => {
                                const cfg = parsedServers[name] as any
                                const isDupe = existingServerNames.includes(name)
                                return (
                                    <Flex key={name} justify="space-between" align="center" p="xs"
                                        style={{
                                            borderRadius: 4,
                                            backgroundColor: isDupe ? 'var(--mantine-color-yellow-light)' : 'var(--mantine-color-default-hover)',
                                            opacity: isDupe ? 0.6 : 1,
                                        }}>
                                        <Flex align="center" gap="sm">
                                            <ScalableIcon icon={IconServer} size={16} />
                                            <Text size="sm" fw={500}>{name}</Text>
                                            <Badge size="xs" variant="outline">{cfg.transport}</Badge>
                                            <Text size="xs" c="chatbox-tertiary" style={{ fontFamily: 'monospace' }}>
                                                {cfg.transport === 'stdio' ? cfg.command : cfg.url}
                                            </Text>
                                        </Flex>
                                        {isDupe && <Badge size="xs" color="yellow">{t('exists')}</Badge>}
                                    </Flex>
                                )
                            })}
                        </Stack>
                    </>
                )}

                <Group justify="flex-end">
                    <Button variant="default" onClick={() => { setInput(''); setParsedServers({}); setError(null); onClose() }}>
                        {t('Cancel')}
                    </Button>
                    <Button onClick={handleImport} disabled={newServers.length === 0}
                        leftSection={<ScalableIcon icon={IconServer} size={16} />}>
                        {t('Import')} {newServers.length > 0 ? `${newServers.length} ${t('Servers')}` : ''}
                    </Button>
                </Group>
            </Stack>
        </AdaptiveModal>
    )
}
