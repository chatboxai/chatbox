import React, { useState, useEffect } from 'react'
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Alert,
  Progress,
  Stepper,
  TextInput,
  Select,
  Checkbox,
  Card,
  Badge,
  Grid,
  ActionIcon,
  Tooltip,
  Modal,
} from '@mantine/core'
import {
  IconCheck,
  IconX,
  IconSettings,
  IconRobot,
  IconKey,
  IconBrain,
  IconPalette,
  IconZap,
  IconInfoCircle,
  IconRefresh,
} from '@tabler/icons-react'
import { useAIProvider } from '../hooks/useAIProvider'
import { AIIntegrationUtils, DEFAULT_AI_CONFIG } from 'src/shared/utils/ai-integration-utils'
import { ModelProviderEnum, type ProviderModelInfo } from 'src/shared/types'

interface AIIntegrationSetupProps {
  onComplete?: (config: any) => void
  onSkip?: () => void
}

export const AIIntegrationSetup: React.FC<AIIntegrationSetupProps> = ({
  onComplete,
  onSkip,
}) => {
  const [activeStep, setActiveStep] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ModelProviderEnum>(ModelProviderEnum.OpenRouter)
  const [selectedModel, setSelectedModel] = useState('')
  const [enabledFeatures, setEnabledFeatures] = useState({
    chat: true,
    imageGeneration: true,
    codeGeneration: true,
    reasoning: true,
    vision: true,
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    availableModels,
    validateApiKey,
    setProvider,
    refreshModels,
    clearError,
  } = useAIProvider()

  useEffect(() => {
    if (isConnected) {
      refreshModels()
    }
  }, [isConnected, refreshModels])

  const steps = [
    { label: 'Welcome', description: 'Introduction to AI Integration' },
    { label: 'Provider Setup', description: 'Configure AI Provider' },
    { label: 'Model Selection', description: 'Choose AI Models' },
    { label: 'Features', description: 'Enable Features' },
    { label: 'Complete', description: 'Setup Complete' },
  ]

  const handleApiKeyValidation = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key')
      return
    }

    setIsValidating(true)
    setError('')

    try {
      const isValid = await validateApiKey(apiKey)
      if (isValid) {
        await setProvider(selectedProvider, { apiKey, models: [] })
        setIsConnected(true)
        setActiveStep(2)
      } else {
        setError('Invalid API key. Please check your key and try again.')
      }
    } catch (error) {
      setError('Failed to validate API key. Please try again.')
    } finally {
      setIsValidating(false)
    }
  }

  const handleModelSelection = (modelId: string) => {
    setSelectedModel(modelId)
  }

  const handleFeatureToggle = (feature: string) => {
    setEnabledFeatures(prev => ({
      ...prev,
      [feature]: !prev[feature],
    }))
  }

  const handleComplete = () => {
    const config = {
      provider: selectedProvider,
      apiKey,
      model: selectedModel,
      features: enabledFeatures,
      timestamp: new Date().toISOString(),
    }
    
    onComplete?.(config)
  }

  const getCapabilityIcon = (capability: string) => {
    switch (capability) {
      case 'vision': return <IconInfoCircle size={16} />
      case 'tool_use': return <IconZap size={16} />
      case 'reasoning': return <IconBrain size={16} />
      case 'image_generation': return <IconPalette size={16} />
      default: return <IconInfoCircle size={16} />
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

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Stack spacing="md">
            <Group>
              <IconRobot size={48} color="blue" />
              <div>
                <Title order={3}>Welcome to AI Integration</Title>
                <Text color="dimmed">
                  Set up AI models to enhance your application with powerful AI capabilities
                </Text>
              </div>
            </Group>
            
            <Alert icon={<IconInfoCircle size={16} />} color="blue">
              <Text size="sm">
                This setup will configure access to 30+ AI models from top providers including 
                OpenAI, Anthropic, Google, Meta, and more through OpenRouter.
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
                      GPT-4, Claude 3.5, Gemini Pro, Llama 3.1, and more
                    </Text>
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
                      DALL-E 3, Midjourney, Stable Diffusion
                    </Text>
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          </Stack>
        )

      case 1:
        return (
          <Stack spacing="md">
            <Group>
              <IconKey size={32} color="green" />
              <div>
                <Title order={3}>Provider Setup</Title>
                <Text color="dimmed">
                  Configure your OpenRouter API key to access AI models
                </Text>
              </div>
            </Group>

            <Alert icon={<IconInfoCircle size={16} />} color="blue">
              <Text size="sm">
                You'll need an OpenRouter API key. 
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
              size="md"
            />

            {error && (
              <Alert color="red" icon={<IconX size={16} />}>
                {error}
              </Alert>
            )}

            <Group position="right">
              <Button
                onClick={handleApiKeyValidation}
                loading={isValidating}
                disabled={!apiKey.trim()}
                size="md"
              >
                Validate & Connect
              </Button>
            </Group>
          </Stack>
        )

      case 2:
        return (
          <Stack spacing="md">
            <Group>
              <IconBrain size={32} color="purple" />
              <div>
                <Title order={3}>Model Selection</Title>
                <Text color="dimmed">
                  Choose your preferred AI model for different tasks
                </Text>
              </div>
            </Group>

            {availableModels.length > 0 ? (
              <Grid>
                {availableModels.slice(0, 6).map((model) => (
                  <Grid.Col key={model.modelId} span={6} md={4}>
                    <Card
                      withBorder
                      style={{
                        cursor: 'pointer',
                        backgroundColor: selectedModel === model.modelId ? '#e3f2fd' : 'white',
                      }}
                      onClick={() => handleModelSelection(model.modelId)}
                    >
                      <Stack spacing="sm">
                        <Group position="apart">
                          <Text weight={500} size="sm">
                            {model.nickname || model.modelId}
                          </Text>
                          {selectedModel === model.modelId && (
                            <IconCheck size={16} color="green" />
                          )}
                        </Group>
                        
                        <Text size="xs" color="dimmed">
                          {model.provider || 'OpenRouter'}
                        </Text>
                        
                        <Group spacing="xs">
                          {model.capabilities?.slice(0, 3).map((capability) => (
                            <Tooltip key={capability} label={capability}>
                              <Badge
                                size="xs"
                                color={getCapabilityColor(capability)}
                                leftSection={getCapabilityIcon(capability)}
                              />
                            </Tooltip>
                          ))}
                        </Group>
                      </Stack>
                    </Card>
                  </Grid.Col>
                ))}
              </Grid>
            ) : (
              <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  No models available. Please check your API key and connection.
                </Text>
              </Alert>
            )}

            <Group position="right">
              <Button
                variant="outline"
                onClick={() => setShowAdvanced(true)}
              >
                Advanced Options
              </Button>
            </Group>
          </Stack>
        )

      case 3:
        return (
          <Stack spacing="md">
            <Group>
              <IconSettings size={32} color="orange" />
              <div>
                <Title order={3}>Feature Configuration</Title>
                <Text color="dimmed">
                  Enable the AI features you want to use
                </Text>
              </div>
            </Group>

            <Stack spacing="md">
              {Object.entries(enabledFeatures).map(([feature, enabled]) => (
                <Card key={feature} withBorder>
                  <Group position="apart">
                    <Group>
                      {feature === 'chat' && <IconRobot size={20} color="blue" />}
                      {feature === 'imageGeneration' && <IconPalette size={20} color="pink" />}
                      {feature === 'codeGeneration' && <IconZap size={20} color="green" />}
                      {feature === 'reasoning' && <IconBrain size={20} color="purple" />}
                      {feature === 'vision' && <IconInfoCircle size={20} color="blue" />}
                      <div>
                        <Text weight={500}>
                          {feature === 'imageGeneration' ? 'Image Generation' :
                           feature === 'codeGeneration' ? 'Code Generation' :
                           feature.charAt(0).toUpperCase() + feature.slice(1)}
                        </Text>
                        <Text size="sm" color="dimmed">
                          {feature === 'chat' && 'AI-powered conversations and text generation'}
                          {feature === 'imageGeneration' && 'Generate images from text descriptions'}
                          {feature === 'codeGeneration' && 'AI-assisted code writing and debugging'}
                          {feature === 'reasoning' && 'Advanced reasoning and problem-solving'}
                          {feature === 'vision' && 'Image analysis and visual understanding'}
                        </Text>
                      </div>
                    </Group>
                    <Checkbox
                      checked={enabled}
                      onChange={() => handleFeatureToggle(feature)}
                    />
                  </Group>
                </Card>
              ))}
            </Stack>
          </Stack>
        )

      case 4:
        return (
          <Stack spacing="md">
            <Group>
              <IconCheck size={32} color="green" />
              <div>
                <Title order={3}>Setup Complete!</Title>
                <Text color="dimmed">
                  Your AI integration is ready to use
                </Text>
              </div>
            </Group>

            <Alert icon={<IconCheck size={16} />} color="green">
              <Text size="sm">
                AI integration has been successfully configured. You can now use AI models 
                throughout your application.
              </Text>
            </Alert>

            <Card withBorder>
              <Stack spacing="sm">
                <Text weight={500}>Configuration Summary:</Text>
                <Text size="sm">Provider: {AIIntegrationUtils.getProviderDisplayName(selectedProvider)}</Text>
                <Text size="sm">Model: {selectedModel}</Text>
                <Text size="sm">Features: {Object.entries(enabledFeatures).filter(([, enabled]) => enabled).map(([feature]) => feature).join(', ')}</Text>
              </Stack>
            </Card>
          </Stack>
        )

      default:
        return null
    }
  }

  return (
    <Container size="md" p="md">
      <Paper shadow="sm" radius="md" p="xl">
        <Stack spacing="xl">
          <div>
            <Title order={2} mb="sm">AI Integration Setup</Title>
            <Text color="dimmed">
              Step {activeStep + 1} of {steps.length}: {steps[activeStep].label}
            </Text>
          </div>

          <Stepper active={activeStep} onStepClick={setActiveStep} breakpoint="sm">
            {steps.map((step, index) => (
              <Stepper.Step
                key={index}
                label={step.label}
                description={step.description}
                icon={index < activeStep ? <IconCheck size={16} /> : undefined}
              />
            ))}
          </Stepper>

          <div style={{ minHeight: '400px' }}>
            {renderStepContent()}
          </div>

          <Group position="apart">
            <Button
              variant="outline"
              onClick={onSkip}
              disabled={activeStep === 0}
            >
              Skip Setup
            </Button>
            
            <Group>
              {activeStep > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setActiveStep(activeStep - 1)}
                >
                  Previous
                </Button>
              )}
              
              {activeStep < steps.length - 1 ? (
                <Button
                  onClick={() => setActiveStep(activeStep + 1)}
                  disabled={activeStep === 1 && !isConnected}
                >
                  Next
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  color="green"
                >
                  Complete Setup
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      </Paper>

      {/* Advanced Options Modal */}
      <Modal
        opened={showAdvanced}
        onClose={() => setShowAdvanced(false)}
        title="Advanced Model Options"
        size="lg"
      >
        <Stack spacing="md">
          <Text size="sm" color="dimmed">
            Configure advanced settings for your AI models
          </Text>
          
          {/* Add advanced configuration options here */}
          <Text size="sm">
            Advanced options will be available in future updates.
          </Text>
        </Stack>
      </Modal>
    </Container>
  )
}

export default AIIntegrationSetup