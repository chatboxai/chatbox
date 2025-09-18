import React, { useState } from 'react'
import {
  Container,
  Title,
  Tabs,
  Stack,
  Group,
  Button,
  Text,
  Badge,
  Card,
  Grid,
  Alert,
  Modal,
  TextInput,
  ActionIcon,
  Tooltip,
  RingProgress,
  Center,
  Progress,
} from '@mantine/core'
import {
  IconRobot,
  IconSettings,
  IconChartBar,
  IconMessage,
  IconPalette,
  IconBrain,
  IconZap,
  IconInfoCircle,
  IconCheck,
  IconX,
  IconHeartbeat,
  IconTrendingUp,
  IconClock,
  IconDatabase,
} from '@tabler/icons-react'
import { AIProductionDashboard } from '../components/ai-production-dashboard'
import { AIProductionChat } from '../components/ai-production-chat'
import { useAIProviderProduction } from '../hooks/useAIProviderProduction'
import { ModelProviderEnum } from 'src/shared/types'

export const AIProductionPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('dashboard')
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [isValidating, setIsValidating] = useState(false)

  const {
    isConnected,
    error,
    healthStatus,
    performanceMetrics,
    validateApiKey,
    setProvider,
    refreshModels,
    refreshUsageStats,
    healthCheck,
    getPerformanceSummary,
    clearError,
  } = useAIProviderProduction({
    enablePerformanceTracking: true,
  })

  const handleApiKeySubmit = async () => {
    if (!apiKey.trim()) return

    setIsValidating(true)
    try {
      const isValid = await validateApiKey(apiKey)
      if (isValid) {
        await setProvider(ModelProviderEnum.OpenRouter, { apiKey, models: [] })
        setShowApiKeyModal(false)
        await refreshModels()
        await refreshUsageStats()
        await healthCheck()
      }
    } catch (error) {
      console.error('Failed to validate API key:', error)
    } finally {
      setIsValidating(false)
    }
  }

  const getStatusBadge = () => {
    if (isConnected) {
      return (
        <Badge color="green" leftSection={<IconCheck size={12} />}>
          Connected
        </Badge>
      )
    }
    return (
      <Badge color="red" leftSection={<IconX size={12} />}>
        Disconnected
      </Badge>
    )
  }

  const getHealthBadge = () => {
    const colors = {
      healthy: 'green',
      degraded: 'yellow',
      unhealthy: 'red',
    }
    
    return (
      <Badge color={colors[healthStatus]} leftSection={<IconHeartbeat size={12} />}>
        {healthStatus.toUpperCase()}
      </Badge>
    )
  }

  const performanceSummary = getPerformanceSummary()

  return (
    <Container size="xl" p="md">
      <Stack spacing="lg">
        {/* Header */}
        <Card>
          <Group position="apart">
            <Group>
              <IconRobot size={32} color="blue" />
              <div>
                <Title order={2}>AI Production Platform</Title>
                <Text color="dimmed">Real-time AI model management and production chat interface</Text>
              </div>
            </Group>
            <Group>
              {getStatusBadge()}
              {getHealthBadge()}
              {!isConnected && (
                <Button
                  leftIcon={<IconSettings size={16} />}
                  onClick={() => setShowApiKeyModal(true)}
                >
                  Connect Provider
                </Button>
              )}
            </Group>
          </Group>
        </Card>

        {/* Error Display */}
        {error && (
          <Alert
            color="red"
            icon={<IconX size={16} />}
            onClose={clearError}
            withCloseButton
          >
            {error}
          </Alert>
        )}

        {/* Quick Stats */}
        <Grid>
          <Grid.Col span={3}>
            <Card>
              <Group>
                <IconBrain size={24} color="purple" />
                <div>
                  <Text size="sm" color="dimmed">Models Available</Text>
                  <Text size="xl" weight={600}>30+</Text>
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
                <IconDatabase size={24} color="blue" />
                <div>
                  <Text size="sm" color="dimmed">Total Requests</Text>
                  <Text size="xl" weight={600}>{performanceSummary.totalRequests}</Text>
                </div>
              </Group>
            </Card>
          </Grid.Col>
        </Grid>

        {/* Performance Overview */}
        <Card>
          <Text weight={500} mb="md">Performance Overview</Text>
          <Grid>
            <Grid.Col span={6}>
              <Stack spacing="sm">
                <Group position="apart">
                  <Text size="sm">System Health</Text>
                  <Badge color={healthStatus === 'healthy' ? 'green' : healthStatus === 'degraded' ? 'yellow' : 'red'}>
                    {healthStatus.toUpperCase()}
                  </Badge>
                </Group>
                <Group position="apart">
                  <Text size="sm">Success Rate</Text>
                  <Text weight={500}>{performanceSummary.successRate.toFixed(1)}%</Text>
                </Group>
                <Progress
                  value={performanceSummary.successRate}
                  color="green"
                  size="sm"
                />
              </Stack>
            </Grid.Col>
            <Grid.Col span={6}>
              <Center>
                <RingProgress
                  size={120}
                  thickness={8}
                  sections={[
                    { value: performanceSummary.successRate, color: 'green' },
                    { value: 100 - performanceSummary.successRate, color: 'red' },
                  ]}
                  label={
                    <Text size="sm" weight={500} ta="center">
                      {performanceSummary.successRate.toFixed(1)}%
                    </Text>
                  }
                />
              </Center>
            </Grid.Col>
          </Grid>
        </Card>

        {/* Main Content */}
        <Tabs value={activeTab} onTabChange={(value) => setActiveTab(value || 'dashboard')}>
          <Tabs.List>
            <Tabs.Tab value="dashboard" icon={<IconChartBar size={16} />}>
              Dashboard
            </Tabs.Tab>
            <Tabs.Tab value="chat" icon={<IconMessage size={16} />}>
              Production Chat
            </Tabs.Tab>
            <Tabs.Tab value="models" icon={<IconBrain size={16} />}>
              Model Explorer
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="dashboard" pt="md">
            <AIProductionDashboard />
          </Tabs.Panel>

          <Tabs.Panel value="chat" pt="md">
            <AIProductionChat
              initialProvider={ModelProviderEnum.OpenRouter}
              initialApiKey={apiKey}
            />
          </Tabs.Panel>

          <Tabs.Panel value="models" pt="md">
            <Card>
              <Stack spacing="md">
                <Title order={3}>Model Explorer</Title>
                <Text color="dimmed">
                  Explore and compare different AI models available through OpenRouter
                </Text>
                
                <Alert icon={<IconInfoCircle size={16} />} color="blue">
                  <Text size="sm">
                    <strong>Available Models:</strong> GPT-4, Claude 3.5 Sonnet, Gemini Pro, Llama 3.1, 
                    Mixtral, DALL-E 3, and many more from top AI providers.
                  </Text>
                </Alert>

                <Grid>
                  <Grid.Col span={6}>
                    <Card withBorder>
                      <Stack spacing="sm">
                        <Group>
                          <IconBrain size={20} color="purple" />
                          <Text weight={500}>Text Models</Text>
                        </Group>
                        <Text size="sm" color="dimmed">
                          Advanced language models for conversation, reasoning, and text generation
                        </Text>
                        <Group spacing="xs">
                          <Badge size="sm">GPT-4</Badge>
                          <Badge size="sm">Claude 3.5</Badge>
                          <Badge size="sm">Gemini Pro</Badge>
                          <Badge size="sm">Llama 3.1</Badge>
                        </Group>
                      </Stack>
                    </Card>
                  </Grid.Col>
                  
                  <Grid.Col span={6}>
                    <Card withBorder>
                      <Stack spacing="sm">
                        <Group>
                          <IconPalette size={20} color="pink" />
                          <Text weight={500}>Image Models</Text>
                        </Group>
                        <Text size="sm" color="dimmed">
                          AI models for image generation, editing, and visual content creation
                        </Text>
                        <Group spacing="xs">
                          <Badge size="sm">DALL-E 3</Badge>
                          <Badge size="sm">Midjourney</Badge>
                          <Badge size="sm">Stable Diffusion</Badge>
                        </Group>
                      </Stack>
                    </Card>
                  </Grid.Col>
                </Grid>
              </Stack>
            </Card>
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {/* API Key Modal */}
      <Modal
        opened={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        title="Connect OpenRouter Provider"
        size="md"
      >
        <Stack spacing="md">
          <Alert icon={<IconInfoCircle size={16} />} color="blue">
            <Text size="sm">
              To use AI models, you need an OpenRouter API key. 
              <br />
              <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer">
                Get your API key here
              </a>
            </Text>
          </Alert>
          
          <TextInput
            label="OpenRouter API Key"
            placeholder="Enter your API key (sk-or-...)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
          />
          
          <Group position="right">
            <Button
              variant="outline"
              onClick={() => setShowApiKeyModal(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApiKeySubmit}
              loading={isValidating}
              disabled={!apiKey.trim()}
            >
              Connect
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  )
}

export default AIProductionPage