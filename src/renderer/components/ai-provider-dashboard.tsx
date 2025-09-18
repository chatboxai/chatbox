import React, { useState, useEffect } from 'react'
import {
  Card,
  Grid,
  Text,
  Button,
  Group,
  Badge,
  Progress,
  Stack,
  Select,
  TextInput,
  Alert,
  Tabs,
  Table,
  ActionIcon,
  Tooltip,
  Modal,
  Textarea,
} from '@mantine/core'
import {
  IconRobot,
  IconSettings,
  IconChartBar,
  IconRefresh,
  IconCheck,
  IconX,
  IconInfoCircle,
  IconZap,
  IconBrain,
  IconEye,
  IconCode,
  IconPalette,
} from '@tabler/icons-react'
import { AIProviderManager } from 'src/shared/models/ai-provider-manager'
import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from 'src/shared/types'

interface AIDashboardProps {
  onProviderChange?: (provider: ModelProviderEnum) => void
  onModelChange?: (model: ProviderModelInfo) => void
}

export const AIProviderDashboard: React.FC<AIDashboardProps> = ({
  onProviderChange,
  onModelChange,
}) => {
  const [providerManager] = useState(() => new AIProviderManager({
    onProviderChange,
    onModelChange,
    onError: (error) => setError(error.message),
  }))
  
  const [currentProvider, setCurrentProvider] = useState<ModelProviderEnum>(ModelProviderEnum.OpenRouter)
  const [currentModel, setCurrentModel] = useState<ProviderModelInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<ProviderModelInfo[]>([])
  const [apiKey, setApiKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState('')
  const [usageStats, setUsageStats] = useState<any>(null)
  const [performanceMetrics, setPerformanceMetrics] = useState<any>({})
  const [selectedModel, setSelectedModel] = useState('')
  const [testPrompt, setTestPrompt] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    try {
      const models = await providerManager.getAvailableModels()
      setAvailableModels(models)
      
      if (models.length > 0) {
        setSelectedModel(models[0].modelId)
        setCurrentModel(models[0])
      }
    } catch (error) {
      setError('Failed to load models')
    }
  }

  const validateApiKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setIsValidating(true)
    setError('')

    try {
      const isValid = await providerManager.validateApiKey(apiKey)
      if (isValid) {
        setIsConnected(true)
        await loadUsageStats()
        await providerManager.setProvider(currentProvider, { apiKey, models: availableModels })
      } else {
        setError('Invalid API key')
      }
    } catch (error) {
      setError('Failed to validate API key')
    } finally {
      setIsValidating(false)
    }
  }

  const loadUsageStats = async () => {
    try {
      const stats = await providerManager.getUsageStats()
      setUsageStats(stats)
    } catch (error) {
      console.error('Failed to load usage stats:', error)
    }
  }

  const testModel = async () => {
    if (!testPrompt.trim() || !selectedModel) {
      setError('Please enter a test prompt and select a model')
      return
    }

    setIsTesting(true)
    setTestResponse('')
    setError('')

    try {
      await providerManager.setModel(selectedModel)
      const response = await providerManager.generateResponse(testPrompt)
      setTestResponse(response.text || 'No response received')
    } catch (error) {
      setError(`Test failed: ${error.message}`)
    } finally {
      setIsTesting(false)
    }
  }

  const getCapabilityIcon = (capability: string) => {
    switch (capability) {
      case 'vision': return <IconEye size={16} />
      case 'tool_use': return <IconZap size={16} />
      case 'reasoning': return <IconBrain size={16} />
      case 'code': return <IconCode size={16} />
      case 'image_generation': return <IconPalette size={16} />
      default: return <IconInfoCircle size={16} />
    }
  }

  const getCapabilityColor = (capability: string) => {
    switch (capability) {
      case 'vision': return 'blue'
      case 'tool_use': return 'green'
      case 'reasoning': return 'purple'
      case 'code': return 'orange'
      case 'image_generation': return 'pink'
      default: return 'gray'
    }
  }

  return (
    <Stack spacing="md">
      {/* Header */}
      <Card>
        <Group position="apart">
          <Group>
            <IconRobot size={32} color="blue" />
            <div>
              <Text size="xl" weight={600}>AI Provider Dashboard</Text>
              <Text size="sm" color="dimmed">Manage and test AI models</Text>
            </div>
          </Group>
          <Group>
            <Button
              leftIcon={<IconSettings size={16} />}
              variant="outline"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </Button>
            <Button
              leftIcon={<IconRefresh size={16} />}
              onClick={loadInitialData}
            >
              Refresh
            </Button>
          </Group>
        </Group>
      </Card>

      {/* Connection Status */}
      <Card>
        <Group position="apart">
          <Group>
            <Text weight={500}>Connection Status</Text>
            {isConnected ? (
              <Badge color="green" leftSection={<IconCheck size={12} />}>
                Connected
              </Badge>
            ) : (
              <Badge color="red" leftSection={<IconX size={12} />}>
                Disconnected
              </Badge>
            )}
          </Group>
          {usageStats && (
            <Group>
              <Text size="sm">Credits: ${usageStats.credits?.toFixed(2) || '0.00'}</Text>
            </Group>
          )}
        </Group>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert color="red" icon={<IconX size={16} />}>
          {error}
        </Alert>
      )}

      <Tabs defaultValue="models">
        <Tabs.List>
          <Tabs.Tab value="models" icon={<IconRobot size={16} />}>Models</Tabs.Tab>
          <Tabs.Tab value="test" icon={<IconZap size={16} />}>Test</Tabs.Tab>
          <Tabs.Tab value="analytics" icon={<IconChartBar size={16} />}>Analytics</Tabs.Tab>
        </Tabs.List>

        {/* Models Tab */}
        <Tabs.Panel value="models" pt="md">
          <Grid>
            {availableModels.map((model) => (
              <Grid.Col key={model.modelId} span={6} md={4}>
                <Card
                  shadow="sm"
                  padding="lg"
                  radius="md"
                  withBorder
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedModel(model.modelId)
                    setCurrentModel(model)
                  }}
                  className={selectedModel === model.modelId ? 'selected-model' : ''}
                >
                  <Stack spacing="sm">
                    <Group position="apart">
                      <Text weight={500} size="sm">
                        {model.nickname || model.modelId}
                      </Text>
                      <Badge size="xs" color="blue">
                        {model.provider || 'OpenRouter'}
                      </Badge>
                    </Group>
                    
                    <Text size="xs" color="dimmed">
                      {model.description || 'AI model'}
                    </Text>
                    
                    <Group spacing="xs">
                      {model.capabilities?.map((capability) => (
                        <Tooltip key={capability} label={capability}>
                          <Badge
                            size="xs"
                            color={getCapabilityColor(capability)}
                            leftSection={getCapabilityIcon(capability)}
                          >
                            {capability}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Group>
                    
                    {model.pricing && (
                      <Text size="xs" color="dimmed">
                        ${model.pricing.input}/1K input, ${model.pricing.output}/1K output
                      </Text>
                    )}
                  </Stack>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        </Tabs.Panel>

        {/* Test Tab */}
        <Tabs.Panel value="test" pt="md">
          <Stack spacing="md">
            <Card>
              <Stack spacing="md">
                <Select
                  label="Select Model"
                  placeholder="Choose a model to test"
                  value={selectedModel}
                  onChange={(value) => setSelectedModel(value || '')}
                  data={availableModels.map(model => ({
                    value: model.modelId,
                    label: `${model.nickname || model.modelId} (${model.provider || 'OpenRouter'})`
                  }))}
                />
                
                <Textarea
                  label="Test Prompt"
                  placeholder="Enter a prompt to test the model..."
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  minRows={3}
                />
                
                <Button
                  onClick={testModel}
                  loading={isTesting}
                  disabled={!testPrompt.trim() || !selectedModel}
                >
                  Test Model
                </Button>
                
                {testResponse && (
                  <Card withBorder>
                    <Text weight={500} mb="sm">Response:</Text>
                    <Text size="sm">{testResponse}</Text>
                  </Card>
                )}
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        {/* Analytics Tab */}
        <Tabs.Panel value="analytics" pt="md">
          <Grid>
            <Grid.Col span={12}>
              <Card>
                <Text weight={500} mb="md">Usage Statistics</Text>
                {usageStats ? (
                  <Stack spacing="sm">
                    <Group position="apart">
                      <Text size="sm">Credits Remaining</Text>
                      <Text weight={500}>${usageStats.credits?.toFixed(2) || '0.00'}</Text>
                    </Group>
                    {usageStats.usage && (
                      <div>
                        <Text size="sm" mb="xs">Usage by Model:</Text>
                        {Object.entries(usageStats.usage).map(([model, usage]: [string, any]) => (
                          <Group key={model} position="apart" mb="xs">
                            <Text size="xs">{model}</Text>
                            <Text size="xs">${usage.cost?.toFixed(4) || '0.0000'}</Text>
                          </Group>
                        ))}
                      </div>
                    )}
                  </Stack>
                ) : (
                  <Text size="sm" color="dimmed">No usage data available</Text>
                )}
              </Card>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
      </Tabs>

      {/* Settings Modal */}
      <Modal
        opened={showSettings}
        onClose={() => setShowSettings(false)}
        title="Provider Settings"
        size="md"
      >
        <Stack spacing="md">
          <TextInput
            label="OpenRouter API Key"
            placeholder="Enter your API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
          />
          
          <Button
            onClick={validateApiKey}
            loading={isValidating}
            disabled={!apiKey.trim()}
          >
            Validate & Connect
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}

export default AIProviderDashboard