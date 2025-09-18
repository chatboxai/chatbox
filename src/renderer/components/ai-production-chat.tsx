import React, { useState, useRef, useEffect } from 'react'
import {
  Container,
  Paper,
  Textarea,
  Button,
  Group,
  Stack,
  Text,
  Avatar,
  ScrollArea,
  ActionIcon,
  Badge,
  Select,
  Tooltip,
  Alert,
  Loader,
  Modal,
  Tabs,
  Progress,
  RingProgress,
  Center,
} from '@mantine/core'
import {
  IconSend,
  IconRobot,
  IconUser,
  IconSettings,
  IconRefresh,
  IconPalette,
  IconBrain,
  IconZap,
  IconInfoCircle,
  IconX,
  IconHeartbeat,
  IconTrendingUp,
  IconClock,
} from '@tabler/icons-react'
import { useAIProviderProduction } from '../hooks/useAIProviderProduction'
import { ModelProviderEnum, type ProviderModelInfo } from 'src/shared/types'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  model?: string
  capabilities?: string[]
  performance?: {
    duration: number
    tokens: number
  }
}

interface AIProductionChatProps {
  initialProvider?: ModelProviderEnum
  initialApiKey?: string
  onMessageSent?: (message: Message) => void
  onResponseReceived?: (response: Message) => void
}

export const AIProductionChat: React.FC<AIProductionChatProps> = ({
  initialProvider = ModelProviderEnum.OpenRouter,
  initialApiKey = '',
  onMessageSent,
  onResponseReceived,
}) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showPerformance, setShowPerformance] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

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
    getPerformanceSummary,
    clearError,
  } = useAIProviderProduction({
    initialProvider,
    initialApiKey,
    autoConnect: !!initialApiKey,
    enablePerformanceTracking: true,
  })

  useEffect(() => {
    if (availableModels.length > 0 && !selectedModel) {
      setSelectedModel(availableModels[0].modelId)
    }
  }, [availableModels, selectedModel])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }

  const handleSendMessage = async () => {
    if (!input.trim() || !selectedModel || !isConnected) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    onMessageSent?.(userMessage)

    const currentInput = input
    setInput('')

    try {
      await setModel(selectedModel)
      const startTime = Date.now()
      const response = await generateResponse(currentInput)
      const duration = Date.now() - startTime
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text || response.content || 'No response received',
        timestamp: new Date(),
        model: selectedModel,
        capabilities: currentModel?.capabilities,
        performance: {
          duration,
          tokens: response.usage?.total_tokens || 0,
        },
      }

      setMessages(prev => [...prev, assistantMessage])
      onResponseReceived?.(assistantMessage)
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to generate response'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  const handleGenerateImage = async () => {
    if (!input.trim() || !isConnected) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `Generate image: ${input}`,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])

    const currentInput = input
    setInput('')

    try {
      const startTime = Date.now()
      const response = await generateImage(currentInput)
      const duration = Date.now() - startTime
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Generated image: ${response.url || 'Image generated successfully'}`,
        timestamp: new Date(),
        model: 'dall-e-3',
        capabilities: ['image_generation'],
        performance: {
          duration,
          tokens: 0,
        },
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to generate image'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  const getCapabilityIcon = (capability: string) => {
    switch (capability) {
      case 'vision': return <IconInfoCircle size={12} />
      case 'tool_use': return <IconZap size={12} />
      case 'reasoning': return <IconBrain size={12} />
      case 'image_generation': return <IconPalette size={12} />
      default: return <IconInfoCircle size={12} />
    }
  }

  const getCapabilityColor = (capability: string) => {
    switch (capability) {
      case 'vision': return 'blue'
      case 'tool_use': return 'green'
      case 'reasoning': return 'purple'
      case 'image_generation': return 'pink'
      default: return 'gray'
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const performanceSummary = getPerformanceSummary()

  return (
    <Container size="lg" p="md">
      <Paper shadow="sm" radius="md" p="md" style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Group position="apart" mb="md">
          <Group>
            <IconRobot size={24} color="blue" />
            <div>
              <Text weight={600}>AI Production Chat</Text>
              <Text size="sm" color="dimmed">
                {isConnected ? `Connected to ${currentProvider}` : 'Not connected'}
              </Text>
            </div>
          </Group>
          <Group>
            <Badge
              color={getHealthColor(healthStatus)}
              leftSection={<IconHeartbeat size={12} />}
            >
              {healthStatus.toUpperCase()}
            </Badge>
            {currentModel && (
              <Badge
                color="blue"
                leftSection={getCapabilityIcon('reasoning')}
                onClick={() => setShowModelSelector(true)}
                style={{ cursor: 'pointer' }}
              >
                {currentModel.nickname || currentModel.modelId}
              </Badge>
            )}
            <ActionIcon
              variant="outline"
              onClick={() => setShowPerformance(true)}
            >
              <IconTrendingUp size={16} />
            </ActionIcon>
            <ActionIcon
              variant="outline"
              onClick={() => setShowSettings(true)}
            >
              <IconSettings size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {/* Error Display */}
        {error && (
          <Alert
            color="red"
            icon={<IconX size={16} />}
            mb="md"
            onClose={clearError}
            withCloseButton
          >
            {error}
          </Alert>
        )}

        {/* Messages */}
        <ScrollArea
          ref={scrollAreaRef}
          style={{ flex: 1 }}
          mb="md"
        >
          <Stack spacing="md">
            {messages.length === 0 ? (
              <Text color="dimmed" ta="center" mt="xl">
                Start a conversation with AI...
              </Text>
            ) : (
              messages.map((message) => (
                <Group
                  key={message.id}
                  position={message.role === 'user' ? 'right' : 'left'}
                  spacing="sm"
                >
                  <Avatar
                    size="sm"
                    color={message.role === 'user' ? 'blue' : 'green'}
                    radius="xl"
                  >
                    {message.role === 'user' ? <IconUser size={16} /> : <IconRobot size={16} />}
                  </Avatar>
                  <Paper
                    p="sm"
                    radius="md"
                    style={{
                      maxWidth: '70%',
                      backgroundColor: message.role === 'user' ? '#e3f2fd' : '#f5f5f5',
                    }}
                  >
                    <Stack spacing="xs">
                      <Text size="sm">{message.content}</Text>
                      <Group spacing="xs">
                        <Text size="xs" color="dimmed">
                          {message.timestamp.toLocaleTimeString()}
                        </Text>
                        {message.model && (
                          <Badge size="xs" color="gray">
                            {message.model}
                          </Badge>
                        )}
                        {message.capabilities?.map((capability) => (
                          <Tooltip key={capability} label={capability}>
                            <Badge
                              size="xs"
                              color={getCapabilityColor(capability)}
                              leftSection={getCapabilityIcon(capability)}
                            />
                          </Tooltip>
                        ))}
                        {message.performance && (
                          <Tooltip label={`${message.performance.duration}ms, ${message.performance.tokens} tokens`}>
                            <Badge size="xs" color="blue" leftSection={<IconClock size={10} />}>
                              {message.performance.duration}ms
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Stack>
                  </Paper>
                </Group>
              ))
            )}
            {isLoading && (
              <Group position="left" spacing="sm">
                <Avatar size="sm" color="green" radius="xl">
                  <IconRobot size={16} />
                </Avatar>
                <Paper p="sm" radius="md" style={{ backgroundColor: '#f5f5f5' }}>
                  <Group spacing="sm">
                    <Loader size="xs" />
                    <Text size="sm" color="dimmed">AI is thinking...</Text>
                  </Group>
                </Paper>
              </Group>
            )}
          </Stack>
        </ScrollArea>

        {/* Input */}
        <Group spacing="sm">
          <Textarea
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            style={{ flex: 1 }}
            minRows={1}
            maxRows={4}
            disabled={!isConnected || isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || !isConnected || isLoading}
            loading={isLoading}
          >
            <IconSend size={16} />
          </Button>
          <Tooltip label="Generate Image">
            <ActionIcon
              onClick={handleGenerateImage}
              disabled={!input.trim() || !isConnected || isLoading}
              color="pink"
              variant="outline"
            >
              <IconPalette size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {/* Usage Stats */}
        {usageStats && (
          <Text size="xs" color="dimmed" mt="sm">
            Credits: ${usageStats.credits?.toFixed(2) || '0.00'} | 
            Requests: {performanceSummary.totalRequests} | 
            Success: {performanceSummary.successRate.toFixed(1)}%
          </Text>
        )}
      </Paper>

      {/* Performance Modal */}
      <Modal
        opened={showPerformance}
        onClose={() => setShowPerformance(false)}
        title="Performance Metrics"
        size="lg"
      >
        <Stack spacing="md">
          <Grid>
            <Grid.Col span={6}>
              <Card>
                <Text weight={500} mb="md">Overview</Text>
                <Stack spacing="sm">
                  <Group position="apart">
                    <Text size="sm">Total Requests</Text>
                    <Text weight={500}>{performanceSummary.totalRequests}</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="sm">Success Rate</Text>
                    <Text weight={500} color="green">{performanceSummary.successRate.toFixed(1)}%</Text>
                  </Group>
                  <Group position="apart">
                    <Text size="sm">Avg Response Time</Text>
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
                <Text size="sm" color="dimmed" ta="center" mt="sm">
                  Success Rate
                </Text>
              </Card>
            </Grid.Col>
          </Grid>
        </Stack>
      </Modal>

      {/* Settings Modal */}
      <Modal
        opened={showSettings}
        onClose={() => setShowSettings(false)}
        title="AI Provider Settings"
        size="md"
      >
        <Tabs defaultValue="connection">
          <Tabs.List>
            <Tabs.Tab value="connection">Connection</Tabs.Tab>
            <Tabs.Tab value="models">Models</Tabs.Tab>
            <Tabs.Tab value="usage">Usage</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="connection" pt="md">
            <Stack spacing="md">
              <Text size="sm" color="dimmed">
                Configure your AI provider connection
              </Text>
              {/* Add connection settings here */}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="models" pt="md">
            <Stack spacing="md">
              <Text size="sm" color="dimmed">
                Available models: {availableModels.length}
              </Text>
              {/* Add model selection here */}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="usage" pt="md">
            <Stack spacing="md">
              {usageStats ? (
                <div>
                  <Text size="sm">Credits: ${usageStats.credits?.toFixed(2) || '0.00'}</Text>
                  {/* Add more usage details here */}
                </div>
              ) : (
                <Text size="sm" color="dimmed">No usage data available</Text>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Modal>

      {/* Model Selector Modal */}
      <Modal
        opened={showModelSelector}
        onClose={() => setShowModelSelector(false)}
        title="Select AI Model"
        size="md"
      >
        <Stack spacing="md">
          {availableModels.map((model) => (
            <Paper
              key={model.modelId}
              p="md"
              radius="md"
              withBorder
              style={{
                cursor: 'pointer',
                backgroundColor: selectedModel === model.modelId ? '#e3f2fd' : 'white',
              }}
              onClick={() => {
                setSelectedModel(model.modelId)
                setShowModelSelector(false)
              }}
            >
              <Group position="apart">
                <div>
                  <Text weight={500}>{model.nickname || model.modelId}</Text>
                  <Text size="sm" color="dimmed">
                    {model.provider || 'OpenRouter'}
                  </Text>
                </div>
                <Group spacing="xs">
                  {model.capabilities?.map((capability) => (
                    <Tooltip key={capability} label={capability}>
                      <Badge
                        size="xs"
                        color={getCapabilityColor(capability)}
                        leftSection={getCapabilityIcon(capability)}
                      />
                    </Tooltip>
                  ))}
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Modal>
    </Container>
  )
}

export default AIProductionChat