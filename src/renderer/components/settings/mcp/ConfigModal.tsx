import {
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
  Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import pTimeout from 'p-timeout'
import { type FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/Overlay'
import { MCPServer } from '@/packages/mcp/controller'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { trackEvent } from '@/utils/track'
import { getConfigFromFormValues, getFormValuesFromConfig, type MCPServerConfigFormValues } from './utils'

interface ConnectionTestingResult {
  config: MCPServerConfig
  tools: { name: string; description?: string }[]
  error?: Error
}

const TestingResult: FC<{ result: ConnectionTestingResult }> = ({ result }) => {
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
      <Text fw="bold" mb="sm">
        {t('Tools')}
      </Text>
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
  const [testingResult, setTestingResult] = useState<ConnectionTestingResult | null>()
  const testingAbortController = useRef<AbortController | null>(null)

  const form = useForm<MCPServerConfigFormValues>({
    mode: 'controlled',
    initialValues: getFormValuesFromConfig(props.config),
  })

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
      const server = new MCPServer(config.transport)
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
    trackEvent('save_mcp_server', { type: values.transport.type, name: values.name })
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
              {t('Test')}
            </Button>
            {props.mode === 'edit' || testingResult ? (
              <Button type="submit">{t('Save')}</Button>
            ) : (
              <Tooltip label={t('Please test before saving')} withArrow zIndex={3000}>
                <Button data-disabled type="submit" onClick={(e) => e.preventDefault()}>
                  {t('Save')}
                </Button>
              </Tooltip>
            )}
          </Group>
        </Group>
        {testingResult && <TestingResult result={testingResult} />}
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
