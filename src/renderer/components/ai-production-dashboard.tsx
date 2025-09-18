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
  RingProgress,
  Center,
  Loader,
  Switch,
  NumberInput,
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
  IconHeartbeat,
  IconTrendingUp,
  IconTrendingDown,
  IconClock,
  IconDatabase,
} from '@tabler/icons-react'
import { useAIProviderProduction } from '../hooks/useAIProviderProduction'
import { ModelProviderEnum, type ProviderModelInfo, type ProviderSettings } from 'src/shared/types'

interface AIProductionDashboardProps {
  onProviderChange?: (provider: ModelProviderEnum) => void
  onModelChange?: (model: ProviderModelInfo) => void
}

export const AIProductionDashboard: React.FC<AIProductionDashboardProps> = ({
  onProviderChange,
  onModelChange,
}) => {
  const [apiKey, setApiKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [testPrompt, setTestPrompt] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(30)

  const {
    currentProvider,
    currentModel,
    availableModels,
    isConnected,
    isLoading,
    error,
    usageStats,
    performanceMetrics,
    healthStatus,
    setProvider,
    setModel,
    generateResponse,
    generateImage,
    validateApiKey,
    refreshModels,
    refreshUsageStats,
    healthCheck,
    getRecommendedModel,
    getPerformanceSummary,
    clearError,
    clearPerformanceHistory,
  } = useAIProviderProduction({
    enablePerformanceTracking: true,
  })

  useEffect(() => {
    if (isConnected) {
      onProviderChange?.(currentProvider)
      onModelChange?.(currentModel)
    }
  }, [isConnected, currentProvider, currentModel, onProviderChange, onModelChange])

  useEffect(() => {
    if (availableModels.length > 0 && !selectedModel) {
      setSelectedModel(availableModels[0].modelId)
    }
  }, [availableModels, selectedModel])

  useEffect(() => {
    if (autoRefresh && isConnected) {
      const interval = setInterval(() => {
        refreshUsageStats()
        healthCheck()
      }, refreshInterval * 1000)

      return () => clearInterval(interval)
    }
  }, [autoRefresh, isConnected, refreshInterval, refreshUsageStats, healthCheck])

  const validateApiKeyHandler = async () => {
    if (!apiKey.trim()) {
      return
    }

    setIsValidating(true)
    clearError()

    try {
      const isValid = await validateApiKey(apiKey)
      if (isValid) {
        await setProvider(currentProvider, { apiKey, models: availableModels })
        await refreshModels()
        await refreshUsageStats()
        setShowSettings(false)
      }
    } catch (error) {
      console.error('Failed to validate API key:', error)
    } finally {
      setIsValidating(false)
    }
  }

  const testModel = async () => {
    if (!testPrompt.trim() || !selectedModel) {
      return
    }

    setIsTesting(true)
    setTestResponse('')
    clearError()

    try {
      await setModel(selectedModel)
      const response = await generateResponse(testPrompt)
      setTestResponse(response.text || 'No response received')
    } catch (error) {
      console.error('Test failed:', error)
    } finally {
      setIsTesting(false)
    }
  }

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'green'
      case 'degraded': return 'yellow'
      case 'unhealthy': return 'red'
      default: return 'gray'
    }
  }

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <IconCheck size={16} />
      case 'degraded': return <IconInfoCircle size={16} />
      case 'unhealthy': return <IconX size={16} />
      default: return <IconInfoCircle size={16} />
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

  const performanceSummary = getPerformanceSummary()

  return (
    <Stack spacing="md">
      {/* Header */}
      <Card>
        <Group position="apart">
          <Group>
            <IconRobot size={32} color="blue" />
            <div>
              <Text size="xl" weight={600}>AI Production Dashboard</Text>
              <Text size="sm" color="dimmed">Real-time AI model management and monitoring</Text>
            </div>
          </Group>
          <Group>
            <Badge
              color={getHealthColor(healthStatus)}
              leftSection={getHealthIcon(healthStatus)}
            >
              {healthStatus.toUpperCase()}
            </Badge>
            <Button
              leftIcon={<IconSettings size={16} />}
              variant="outline"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </Button>
            <Button
              leftIcon={<IconRefresh size={16} />}
              onClick={() => {
                refreshModels()
                refreshUsageStats()
                healthCheck()
              }}
              loading={isLoading}
            >
              Refresh
            </Button>
          </Group>
        </Group>
      </Card>

      {/* Status Cards */}
      <Grid>
        <Grid.Col span={3}>
          <Card>
            <Group>
              <IconDatabase size={24} color="blue" />
              <div>
                <Text size="sm" color="dimmed">Models Available</Text>
                <Text size="xl" weight={600}>{availableModels.length}</Text>
              </div>
            </Group>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Group>
              <IconTrendingUp size={24} color="green" />
              <div>
                <Text size="sm" color="dimmed">Success Rate</Text>
                <Text size="xl" weight={600}>{performanceSummary.successRate.toFixed(1)}%</Text>
              </div>
            </Group>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Group>
              <IconClock size={24} color="orange" />
              <div>
                <Text size="sm" color="dimmed">Avg Response</Text>
                <Text size="xl" weight={600}>{performanceSummary.averageResponseTime.toFixed(0)}ms</Text>
              </div>
            </Group>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Group>
              <IconHeartbeat size={24} color="red" />
              <div>
                <Text size="sm" color="dimmed">Total Requests</Text>
                <Text size="xl" weight={600}>{performanceSummary.totalRequests}</Text>
              </div>
            </Group>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Error Display */}
      {error && (
        <Alert color="red" icon={<IconX size={16} />} onClose={clearError} withCloseButton>
          {error}
        </Alert>
      )}

      <Tabs defaultValue="models">
        <Tabs.List>
          <Tabs.Tab value="models" icon={<IconRobot size={16} />}>Models</Tabs.Tab>
          <Tabs.Tab value="test" icon={<IconZap size={16} />}>Test</Tabs.Tab>
          <Tabs.Tab value="analytics" icon={<IconChartBar size={16} />}>Analytics</Tabs.Tab>
          <Tabs.Tab value="performance" icon={<IconTrendingUp size={16} />}>Performance</Tabs.Tab>
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

        {/* Performance Tab */}
        <Tabs.Panel value="performance" pt="md">
          <Grid>
            <Grid.Col span={6}>
              <Card>
                <Text weight={500} mb="md">Performance Overview</Text>
                <Stack spacing="md">
                  <Group position="apart">
                    <Text size="sm">Total Requests</Text>
                    <Text weight={500}>{performanceSummary.totalRequests}</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="sm">Success Rate</Text>
                    <Text weight={500} color="green">{performanceSummary.successRate.toFixed(1)}%</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="sm">Average Response Time</Text>
                    <Text weight={500}>{performanceSummary.averageResponseTime.toFixed(0)}ms</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="sm">Total Tokens</Text>
                    <Text weight={500}>{performanceSummary.totalTokens.toLocaleString()}</Text>
                  </Group>
                </Stack>
              </Card>
            </Grid.Col>
            <Grid.Col span={6}>
              <Card>
                <Text weight={500} mb="md">Model Performance</Text>
                <Stack spacing="sm">
                  {Object.entries(performanceSummary.models).map(([modelId, metrics]: [string, any]) => (
                    <div key={modelId}>
                      <Group position="apart" mb="xs">
                        <Text size="sm">{modelId}</Text>
                        <Text size="xs">{metrics.requests} requests</Text>
                      </Group>
                      <Progress
                        value={(metrics.successfulRequests / metrics.requests) * 100}
                        color="green"
                        size="sm"
                      />
                    </div>
                  ))}
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
      </Tabs>

      {/* Settings Modal */}
      <Modal
        opened={showSettings}
        onClose={() => setShowSettings(false)}
        title="Production Settings"
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
          
          <Switch
            label="Auto Refresh"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
          />
          
          {autoRefresh && (
            <NumberInput
              label="Refresh Interval (seconds)"
              value={refreshInterval}
              onChange={(value) => setRefreshInterval(value || 30)}
              min={10}
              max={300}
            />
          )}
          
          <Group position="apart">
            <Button
              variant="outline"
              onClick={() => clearPerformanceHistory()}
            >
              Clear History
            </Button>
            <Button
              onClick={validateApiKeyHandler}
              loading={isValidating}
              disabled={!apiKey.trim()}
            >
              Validate & Connect
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

export default AIProductionDashboard