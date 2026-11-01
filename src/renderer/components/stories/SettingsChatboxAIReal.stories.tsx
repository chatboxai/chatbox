import { Box, Paper, SimpleGrid, Stack, Text } from '@mantine/core'
import type { ChatboxAILicenseDetail, ProviderModelInfo } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef } from 'react'
import type { UserLicense } from '@/packages/remote'
import { EmailCodeLoginModal } from '@/routes/settings/provider/chatbox-ai/-components/EmailCodeLoginModal'
import { LicenseDetailCard } from '@/routes/settings/provider/chatbox-ai/-components/LicenseDetailCard'
import { LicenseKeyView } from '@/routes/settings/provider/chatbox-ai/-components/LicenseKeyView'
import { LicenseSelectionModal } from '@/routes/settings/provider/chatbox-ai/-components/LicenseSelectionModal'
import { LoggedInView } from '@/routes/settings/provider/chatbox-ai/-components/LoggedInView'
import { LoginView } from '@/routes/settings/provider/chatbox-ai/-components/LoginView'
import { ModelManagement } from '@/routes/settings/provider/chatbox-ai/-components/ModelManagement'
import { settingsStore } from '@/stores/settingsStore'

const activeLicenseKey = 'cbai-story-license-key-1234567890abcdef'

const licenseDetail: ChatboxAILicenseDetail = {
  type: 'chatboxai-4',
  name: 'Chatbox AI Pro',
  status: 'active',
  defaultModel: 'chatboxai-4',
  remaining_quota_35: 1800,
  remaining_quota_4: 840,
  remaining_quota_image: 22,
  image_used_count: 8,
  image_total_quota: 30,
  plan_image_limit: 30,
  token_refreshed_time: '2026-06-01T00:00:00.000Z',
  token_next_refresh_time: '2026-07-01T00:00:00.000Z',
  token_expire_time: '2026-12-31T23:59:59.000Z',
  remaining_quota_unified: 840000,
  expansion_pack_limit: 250000,
  expansion_pack_usage: 45000,
  unified_token_usage: 160000,
  unified_token_limit: 1000000,
  unified_token_usage_details: [
    {
      type: 'plan',
      token_usage: 160000,
      token_limit: 1000000,
      expires_at: '2026-12-31T23:59:59.000Z',
    },
  ],
  aggregated_reward_details: {
    type: 'reward',
    token_usage: 12000,
    token_limit: 50000,
    expires_at: '2026-08-31T23:59:59.000Z',
  },
  key: activeLicenseKey,
  price_type: 'monthly',
  order_type: 'subscription',
}

const expiredLicenseDetail: ChatboxAILicenseDetail = {
  ...licenseDetail,
  name: 'Chatbox AI Team Trial',
  status: 'expired',
  token_expire_time: '2026-01-01T00:00:00.000Z',
  remaining_quota_unified: 0,
  expansion_pack_limit: 0,
  expansion_pack_usage: 0,
  unified_token_usage: 1000000,
  unified_token_usage_details: [
    {
      type: 'plan',
      token_usage: 1000000,
      token_limit: 1000000,
      expires_at: '2026-01-01T00:00:00.000Z',
    },
  ],
}

const userLicenses: UserLicense[] = [
  {
    id: 101,
    key: activeLicenseKey,
    status: 'active',
    platform: 'chatboxai',
    product_name: 'Chatbox AI Pro',
    payment_type: 'subscription',
    image_usage: 8,
    unified_token_usage: 160000,
    unified_token_limit: 1000000,
    unified_token_usage_details: licenseDetail.unified_token_usage_details,
    image_limit: 30,
    next_token_refresh_at: '2026-07-01T00:00:00.000Z',
    expires_at: '2026-12-31T23:59:59.000Z',
    created_at: '2026-01-15T09:30:00.000Z',
    recurring_canceled: false,
    quota_packs: [],
  },
  {
    id: 102,
    key: 'cbai-story-expired-license-abcdef123456',
    status: 'expired',
    platform: 'chatboxai',
    product_name: 'Chatbox AI Team Trial',
    payment_type: 'trial',
    image_usage: 30,
    unified_token_usage: 1000000,
    unified_token_limit: 1000000,
    unified_token_usage_details: expiredLicenseDetail.unified_token_usage_details,
    image_limit: 30,
    next_token_refresh_at: '2026-02-01T00:00:00.000Z',
    expires_at: '2026-01-01T00:00:00.000Z',
    created_at: '2025-12-01T08:00:00.000Z',
    recurring_canceled: true,
    quota_packs: [],
  },
]

const selectionLicenses: UserLicense[] = [
  ...userLicenses,
  {
    ...userLicenses[0],
    id: 103,
    key: 'cbai-story-expiring-license-7890abcd',
    product_name: 'Chatbox AI Lite',
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    recurring_canceled: true,
  },
  {
    ...userLicenses[0],
    id: 104,
    key: 'cbai-story-quota-used-license-4567efgh',
    product_name: 'Chatbox AI Plus',
    unified_token_usage: 1000000,
  },
  {
    ...userLicenses[0],
    id: 105,
    key: 'cbai-story-refunded-license-0123ijkl',
    status: 'refunded',
    product_name: 'Chatbox AI Pro',
  },
]

const chatboxAIModels: ProviderModelInfo[] = [
  {
    modelId: 'chatboxai-4',
    nickname: 'Chatbox AI 4',
    labels: ['recommended', 'pro'],
    capabilities: ['vision', 'tool_use', 'reasoning'],
    contextWindow: 200000,
    maxOutput: 8000,
  },
  {
    modelId: 'chatboxai-3.5',
    nickname: 'Chatbox AI 3.5',
    labels: ['fast'],
    capabilities: ['tool_use'],
    contextWindow: 128000,
  },
]

const allChatboxAIModels: ProviderModelInfo[] = [
  ...chatboxAIModels,
  {
    modelId: 'chatboxai-image',
    nickname: 'Chatbox AI Image',
    type: 'image',
    labels: ['new'],
    capabilities: ['vision'],
  },
]

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    },
  },
})

const meta: Meta = {
  title: 'Real Components/Settings Chatbox AI',
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <SeedSettings />
        <Box p="lg" bg="var(--chatbox-background-primary)" style={{ minHeight: 620 }}>
          <Story />
        </Box>
      </QueryClientProvider>
    ),
  ],
}

export default meta

export const LoginViewStates: StoryObj = {
  name: 'Chatbox AI login view real account entry states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/LoginView'],
  },
  render: () => (
    <SettingsSurface
      title="LoginView"
      description="Actual Chatbox AI account login entry with promotion and license-key fallback."
    >
      <LoginView language="en" saveAuthTokens={async () => undefined} onSwitchToLicenseKey={() => undefined} />
    </SettingsSurface>
  ),
}

export const EmailCodeLoginModalStates: StoryObj = {
  name: 'Email code login modal email and verification states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/EmailCodeLoginModal'],
  },
  render: () => (
    <SettingsSurface
      title="EmailCodeLoginModal"
      description="Actual email-code login modal with email, code, terms, cancel, and verify actions."
    >
      <EmailCodeLoginModal opened onClose={() => undefined} language="en" onLoginSuccess={async () => undefined} />
    </SettingsSurface>
  ),
}

export const LicenseKeyViewStates: StoryObj = {
  name: 'License key view inactive activation and purchase states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/LicenseKeyView'],
  },
  render: () => (
    <SettingsSurface
      title="LicenseKeyView"
      description="Actual manual license-key entry state with Chatbox AI value proposition and purchase/retrieve actions."
    >
      <LicenseKeyView language="en" onSwitchToLogin={() => undefined} />
    </SettingsSurface>
  ),
}

export const LoggedInViewStates: StoryObj = {
  name: 'Logged in account selected license and quota states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/LoggedInView'],
  },
  render: () => (
    <SettingsSurface
      title="LoggedInView"
      description="Actual logged-in Chatbox AI account state with license selector, quota details, logout, and plan actions."
    >
      <LoggedInView
        language="en"
        onLogout={() => undefined}
        onSwitchToLicenseKey={() => undefined}
        initialAccountData={{
          userProfile: {
            id: 'user_story_001',
            email: 'product@example.com',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          licenses: userLicenses,
          licenseDetailResponse: { data: licenseDetail },
        }}
      />
    </SettingsSurface>
  ),
}

export const LicenseSelectionModalStates: StoryObj = {
  name: 'License selection modal active expired and quota states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/LicenseSelectionModal'],
  },
  render: () => (
    <SettingsSurface
      title="LicenseSelectionModal"
      description="Actual modal shown when an account has multiple licenses to choose from."
    >
      <LicenseSelectionModal
        opened
        licenses={selectionLicenses}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    </SettingsSurface>
  ),
}

export const LicenseDetailCardStates: StoryObj = {
  name: 'License detail card active expired quota and reward states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/LicenseDetailCard'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="LicenseDetailCard"
        description="Actual quota card used by manual and logged-in license states."
      />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" mb="sm">
            Active plan
          </Text>
          <LicenseDetailCard licenseDetail={licenseDetail} language="en" utmContent="story_active_license" />
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text size="xs" c="dimmed" mb="sm">
            Expired and empty quota
          </Text>
          <LicenseDetailCard licenseDetail={expiredLicenseDetail} language="en" utmContent="story_expired_license" />
        </Paper>
      </SimpleGrid>
    </Stack>
  ),
}

export const ModelManagementStates: StoryObj = {
  name: 'Model management list fetch reset add remove states',
  parameters: {
    uiInventoryTargets: ['src/renderer/routes/settings/provider/chatbox-ai/-components/ModelManagement'],
  },
  render: () => (
    <SettingsSurface
      title="ModelManagement"
      description="Actual Chatbox AI model management list with reset, fetch, delete, and fetched-model modal states."
    >
      <ModelManagement
        chatboxAIModels={chatboxAIModels}
        allChatboxAIModels={allChatboxAIModels}
        onDeleteModel={() => undefined}
        onResetModels={() => undefined}
        onFetchModels={() => undefined}
        onAddModel={() => undefined}
        onRemoveModel={() => undefined}
      />
      <Text size="xs" c="dimmed">
        Click Fetch in the preview to open the production fetched-model modal state.
      </Text>
    </SettingsSurface>
  ),
}

function SeedSettings() {
  const seededRef = useRef(false)

  if (!seededRef.current) {
    settingsStore.setState({
      licenseKey: activeLicenseKey,
      licenseActivationMethod: 'login',
      licenseInstances: {
        [activeLicenseKey]: 'story-instance',
      },
      lastSelectedLicenseByUser: {
        'product@example.com': activeLicenseKey,
      },
      memorizedManualLicenseKey: '',
    })
    seededRef.current = true
  }

  return null
}

function SettingsSurface({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Stack gap="lg" maw={980}>
      <SurfaceLabel title={title} description={description} />
      <Paper withBorder radius="md" p="md">
        {children}
      </Paper>
    </Stack>
  )
}

function SurfaceLabel({ title, description }: { title: string; description: string }) {
  return (
    <Stack gap={2}>
      <Text fw={700}>{title}</Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
    </Stack>
  )
}
