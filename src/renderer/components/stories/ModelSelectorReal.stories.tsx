import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { settingsStore } from '@/stores/settingsStore'
import { ModelSelectorV2 } from '../ModelSelectorV2'

const openAIModels: ProviderModelInfo[] = [
  {
    modelId: 'gpt-4.1',
    nickname: 'GPT-4.1',
    labels: ['recommended', 'new'],
    capabilities: ['vision', 'tool_use'],
    contextWindow: 1_000_000,
  },
  {
    modelId: 'o3',
    nickname: 'o3',
    labels: ['pro'],
    capabilities: ['reasoning', 'tool_use'],
    contextWindow: 200_000,
  },
  {
    modelId: 'text-embedding-3-large',
    nickname: 'Text Embedding 3 Large',
    type: 'embedding',
  },
]

const claudeModels: ProviderModelInfo[] = [
  {
    modelId: 'claude-sonnet-4-20250514',
    nickname: 'Claude Sonnet 4',
    labels: ['recommended'],
    capabilities: ['vision', 'reasoning', 'tool_use'],
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-haiku-3.5',
    nickname: 'Claude Haiku 3.5',
    capabilities: ['vision'],
    contextWindow: 200_000,
  },
]

const customModels: ProviderModelInfo[] = [
  {
    modelId: 'local-agent-32b',
    nickname: 'Local Agent 32B',
    capabilities: ['tool_use'],
    contextWindow: 64_000,
  },
]

const meta: Meta = {
  title: 'Real Components/Model Selector',
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <SeededProviderSettings>
          <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 820, minHeight: 520 }}>
            <Story />
          </Box>
        </SeededProviderSettings>
      </QueryClientProvider>
    ),
  ],
}

export default meta

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  },
})

export const ModelSelectorDropdownStates: StoryObj = {
  name: 'Model selector dropdown with configured providers',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/ModelSelectorV2/index'],
  },
  render: () => <ModelSelectorV2Fixture />,
}

function ModelSelectorV2Fixture() {
  const triggerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState('openai/gpt-4.1')

  useEffect(() => {
    const timer = window.setTimeout(() => triggerRef.current?.click(), 150)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="ModelSelectorV2"
        description="Actual responsive model selector entry point backed by configured provider settings."
      />
      <Group align="flex-start">
        <ModelSelectorV2
          ref={triggerRef}
          selectedProviderId={selected.split('/')[0]}
          selectedModelId={selected.split('/')[1]}
          showAuto
          autoText="Auto select"
          onSelect={(provider, model) => setSelected(provider && model ? `${provider}/${model}` : 'auto')}
          modelDisabledCheck={(model) =>
            model.modelId === 'o3' ? 'Reasoning models are disabled in this fixture' : undefined
          }
          withinPortal={false}
        >
          <Button variant="light">{selected === 'auto' ? 'Auto select' : selected}</Button>
        </ModelSelectorV2>
        <Text size="sm" c="dimmed" maw={280}>
          The dropdown is opened by the real trigger after mount so the story captures the production menu state.
        </Text>
      </Group>
    </Stack>
  )
}

function SeededProviderSettings({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    settingsStore.setState({
      providers: {
        [ModelProviderEnum.OpenAI]: {
          apiKey: 'storybook-openai-key',
          models: openAIModels,
        },
        [ModelProviderEnum.Claude]: {
          apiKey: 'storybook-claude-key',
          models: claudeModels,
        },
        'custom-provider': {
          apiKey: 'storybook-local-key',
          models: customModels,
        },
      },
      customProviders: [
        {
          id: 'custom-provider',
          name: 'Local Gateway',
          type: 'openai',
          isCustom: true,
        },
      ],
      favoritedModels: [
        { provider: ModelProviderEnum.OpenAI, model: 'gpt-4.1' },
        { provider: ModelProviderEnum.Claude, model: 'claude-sonnet-4-20250514' },
      ],
    })
  }, [])

  return children
}

function SurfaceLabel({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Text fw={700}>{title}</Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
    </Box>
  )
}
