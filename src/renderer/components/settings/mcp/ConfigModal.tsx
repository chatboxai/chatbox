import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Kbd,
  Paper,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconRefresh } from '@tabler/icons-react'
import type { ToolSet } from 'ai'
import pTimeout from 'p-timeout'
import { type FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/layout/Overlay'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useMCPServerStatus } from '@/hooks/mcp'
import { MCPServer, mcpController } from '@/packages/mcp/controller'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { trackEvent } from '@/utils/track'
import { getConfigFromFormValues, getFormValuesFromConfig, type MCPServerConfigFormValues } from './utils'

interface ConnectionTestingResult {
  config: MCPServerConfig
  tools: { name: string; description?: string }[]
  error?: Error
}

function toToolSummaries(tools: ToolSet): ConnectionTestingResult['tools'] {
  return Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description }))
}

const TestingResult: FC<{ result: ConnectionTestingResult; onRefresh?: () => void; refreshing?: boolean }> = ({
  result,
  onRefresh,
  refreshing,
}) => {
  const { t } = useTranslation()
  if (result.error) {
    return (
      <Paper withBorder p="md" mt="md">
        <Text size="sm" c="chatbox-error" className="whitespace-pre-line overflow-x-auto">
          {result.error.message}
        </Text>
        {result.error.message.includes('ENOENT') && result.config.transport.type === 'stdio' && (
          <Text size="sm" c="chatbox-primary" mt="sm">
            {t('Make sure you have the following command installed:')} <Kbd>{result.config.transport.command}</Kbd>
          </Text>
        )}
      </Paper>
    )
  }
  return (
    <Paper withBorder p="md" mt="md">
      <Group justify="space-between" mb="sm">
        <Text fw="bold">{t('Tools')}</Text>
        {onRefresh && (
          <Tooltip label={t('Refresh')} withArrow zIndex={3000}>
            <ActionIcon variant="subtle" size="sm" loading={refreshing} onClick={onRefresh} aria-label={t('Refresh')}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <Group gap="xs">
        {result.tools.map((tool) => (
          <Badge key={tool.name} color="blue" variant="outline" size="md" className="!lowercase">
            {tool.name}
          </Badge>
        ))}
      </Group>
    </Paper>
  )
}

const ConfigForm: FC<{
  mode: 'add' | 'edit'
  config: MCPServerConfig
  onSave: (config: MCPServerConfig) => void
  onDelete: (id: string) => void
}> = (props) => {
  const { t } = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  const [testing, setTesting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [testingResult, setTestingResult] = useState<ConnectionTestingResult | null>()
  const testingAbortController = useRef<AbortController | null>(null)
  const liveStatus = useMCPServerStatus(props.config.id)

  const form = useForm<MCPServerConfigFormValues>({
    mode: 'controlled',
    initialValues: getFormValuesFromConfig(props.config),
  })

  // While editing, mirror the running instance so its tools (or its startup error) are always visible.
  useEffect(() => {
    if (props.mode !== 'edit') {
      return
    }
    const server = mcpController.getServer(props.config.id)
    if (liveStatus?.state === 'running' && server) {
      setTestingResult({ config: props.config, tools: toToolSummaries(server.getAvailableTools()) })
    } else if (liveStatus?.error) {
      setTestingResult({ config: props.config, tools: [], error: new Error(liveStatus.error) })
    }
  }, [props.mode, props.config, liveStatus?.state, liveStatus?.error])

  const refreshTools = async () => {
    const server = mcpController.getServer(props.config.id)
    if (!server || server.status.state !== 'running') {
      return testConnection()
    }
    setRefreshing(true)
    try {
      setTestingResult({ config: props.config, tools: toToolSummaries(await server.refreshTools()) })
    } catch (err) {
      setTestingResult({ config: props.config, tools: [], error: err as Error })
    } finally {
      setRefreshing(false)
    }
  }

  const testConnection = async () => {
    if (formRef.current && !formRef.current.reportValidity()) {
      return
    }
    const config = getConfigFromFormValues(form.getValues())
    console.debug('Testing connection with config', config)
    setTesting(true)
    setTestingResult(null)
    trackEvent('test_mcp_server_connection', { type: config.transport.type })
    try {
      const server = new MCPServer(config)
      testingAbortController.current = new AbortController()
      await pTimeout(server.start(), {
        milliseconds: 5 * 60_000,
        signal: testingAbortController.current.signal,
      })
      if (server.status.state !== 'running') {
        throw new Error(server.status.error || `Failed to start server: ${server.status.state}`)
      }
      const tools = await server.getAvailableTools()
      setTestingResult({
        config,
        tools: Object.keys(tools).map((name) => ({ name, description: tools[name].description })),
      })
      await server.stop()
    } catch (err) {
      if (testingAbortController.current?.signal.aborted) {
        return
      }
      setTestingResult({ config, error: err as Error, tools: [] })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = (values: typeof form.values) => {
    console.debug('form onSubmit', values)
    trackEvent('save_mcp_server', { type: values.transport.type })
    return props.onSave(getConfigFromFormValues(values))
  }

  return (
    <form ref={formRef} onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="md">
        <TextInput label={t('Name')} data-autofocus required {...form.getInputProps('name')} />
        <Radio.Group
          required
          label={t('Type')}
          {...form.getInputProps('transport.type')}
          labelProps={{ fw: 600, mb: 'xs' }}
        >
          <Group>
            <Radio variant="outline" size="sm" value="http" label={t('Remote (http/sse)')} />
            <Radio variant="outline" size="sm" value="stdio" label={t('Local (stdio)')} />
          </Group>
        </Radio.Group>
        <Stack gap={4}>
          <Radio.Group
            required
            label={t('Protocol')}
            {...form.getInputProps('protocolMode')}
            labelProps={{ fw: 600, mb: 'xs' }}
          >
            <Group>
              <Radio variant="outline" size="sm" value="auto" label={t('Auto (recommended)')} />
              <Radio variant="outline" size="sm" value="legacy" label={t('Legacy')} />
            </Group>
          </Radio.Group>
          <Text size="xs" c="chatbox-tertiary">
            {t(
              "If you're unsure, keep Auto. Choose Legacy only if you know the server does not support stateless MCP."
            )}
          </Text>
        </Stack>
        {form.values.transport.type === 'stdio' && (
          <>
            <Textarea
              label={t('Command')}
              placeholder="npx mcp-server arg1 arg2..."
              required
              autosize
              minRows={1}
              {...form.getInputProps('transport.command')}
            />
            <Textarea
              label={t('Environment Variables')}
              placeholder="KEY=VALUE"
              autosize
              minRows={3}
              {...form.getInputProps('transport.env')}
            />
          </>
        )}
        {form.values.transport.type === 'http' && (
          <>
            <TextInput label="URL" required placeholder="https://..." {...form.getInputProps('transport.url')} />
            <Textarea
              label="HTTP Header"
              placeholder="NAME=VALUE"
              autosize
              minRows={3}
              {...form.getInputProps('transport.headers')}
            />
          </>
        )}
        <Group justify="space-between">
          {props.mode === 'edit' ? (
            <Anchor c="chatbox-error" onClick={() => props.onDelete(props.config.id)}>
              {t('Delete')}
            </Anchor>
          ) : (
            <Text />
          )}
          <Group justify="flex-end" gap="sm">
            {testing && (
              <Button variant="subtle" color="red" onClick={() => testingAbortController.current?.abort()}>
                {t('Cancel')}
              </Button>
            )}
            <Button variant="outline" onClick={testConnection} loading={testing} disabled={testing}>
              {t('Connect')}
            </Button>
            {props.mode === 'edit' || testingResult ? (
              <Button type="submit">{t('Save')}</Button>
            ) : (
              <Tooltip label={t('Please connect before saving')} withArrow zIndex={3000}>
                <Button data-disabled type="submit" onClick={(e) => e.preventDefault()}>
                  {t('Save')}
                </Button>
              </Tooltip>
            )}
          </Group>
        </Group>
        {testingResult && (
          <TestingResult
            result={testingResult}
            onRefresh={props.mode === 'edit' ? refreshTools : undefined}
            refreshing={refreshing}
          />
        )}
      </Stack>
    </form>
  )
}

interface Props {
  mode?: 'add' | 'edit'
  config: MCPServerConfig | null
  onClose: () => void
  onSave: (config: MCPServerConfig) => void
  onDelete: (id: string) => void
}

export const ConfigModal: FC<Props> = (props) => {
  const { t } = useTranslation()
  return (
    <Modal
      size="lg"
      opened={!!props.config}
      onClose={props.onClose}
      title={props.mode === 'edit' ? t('Edit MCP Server') : t('Add MCP Server')}
      centered
      overlayProps={{ backgroundOpacity: 0.35, blur: 7 }}
    >
      {props.mode && props.config && (
        <ConfigForm mode={props.mode} config={props.config} onSave={props.onSave} onDelete={props.onDelete} />
      )}
    </Modal>
  )
}
