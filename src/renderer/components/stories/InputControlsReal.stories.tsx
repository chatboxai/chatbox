import { ActionIcon, Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconFileZip } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { ImageUploadButton } from '../InputBox/ImageUploadButton'
import { ImageUploadInput } from '../InputBox/ImageUploadInput'
import { SessionSettingsButton } from '../InputBox/SessionSettingsButton'
import TokenCountMenu from '../InputBox/TokenCountMenu'
import { WebBrowsingButton } from '../InputBox/WebBrowsingButton'

const meta: Meta = {
  title: 'Real Components/Input Controls',
  decorators: [
    (Story) => (
      <Box p="lg" bg="var(--chatbox-background-primary)" style={{ maxWidth: 720, minHeight: 320 }}>
        <Story />
      </Box>
    ),
  ],
}

export default meta

export const WebBrowsingButtonStates: StoryObj = {
  name: 'Web browsing button active and inactive states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/WebBrowsingButton'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="WebBrowsingButton"
        description="Actual toolbar button used to toggle web browsing for the next user message."
      />
      <Group>
        <ToolbarSample label="Inactive">
          <WebBrowsingButton active={false} onClick={() => undefined} />
        </ToolbarSample>
        <ToolbarSample label="Active">
          <WebBrowsingButton active onClick={() => undefined} />
        </ToolbarSample>
        <ToolbarSample label="Mobile active">
          <WebBrowsingButton active isMobile onClick={() => undefined} />
        </ToolbarSample>
      </Group>
    </Stack>
  ),
}

export const SessionSettingsButtonStates: StoryObj = {
  name: 'Session settings button enabled disabled and mobile states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/SessionSettingsButton'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="SessionSettingsButton"
        description="Actual conversation settings affordance shown in the input toolbar."
      />
      <Group>
        <ToolbarSample label="Enabled">
          <SessionSettingsButton tooltipLabel="Conversation Settings" onClick={() => undefined} />
        </ToolbarSample>
        <ToolbarSample label="Disabled">
          <SessionSettingsButton tooltipLabel="Conversation Settings" disabled onClick={() => undefined} />
        </ToolbarSample>
        <ToolbarSample label="Mobile">
          <SessionSettingsButton tooltipLabel="Conversation Settings" isMobile onClick={() => undefined} />
        </ToolbarSample>
      </Group>
    </Stack>
  ),
}

export const ImageUploadButtonStates: StoryObj = {
  name: 'Image upload button desktop and mobile states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/ImageUploadButton'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="ImageUploadButton"
        description="Actual image attachment trigger used by image-capable models."
      />
      <Group>
        <ToolbarSample label="Desktop">
          <ImageUploadButton tooltipLabel="Attach images" onClick={() => undefined} />
        </ToolbarSample>
        <ToolbarSample label="Mobile">
          <ImageUploadButton tooltipLabel="Attach images" isMobile onClick={() => undefined} />
        </ToolbarSample>
      </Group>
    </Stack>
  ),
}

export const ImageUploadInputState: StoryObj = {
  name: 'Hidden image upload input configuration',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/ImageUploadInput'],
  },
  render: () => <ImageUploadInputFixture />,
}

export const TokenCountMenuStates: StoryObj = {
  name: 'Token count menu normal calculating and auto compaction states',
  parameters: {
    uiInventoryTargets: ['src/renderer/components/InputBox/TokenCountMenu'],
  },
  render: () => (
    <Stack gap="lg">
      <SurfaceLabel
        title="TokenCountMenu"
        description="Actual token estimate dropdown used in the input toolbar with compression and auto-compaction controls."
      />
      <Group align="flex-start">
        <TokenCountMenu
          currentInputTokens={128}
          contextTokens={43_200}
          totalTokens={43_328}
          contextWindow={128_000}
          currentMessageCount={22}
          maxContextMessageCount={50}
          onCompressClick={() => undefined}
          autoCompactionEnabled
          onAutoCompactionChange={() => undefined}
        >
          <Button variant="light" size="xs">
            Normal usage
          </Button>
        </TokenCountMenu>
        <TokenCountMenu
          currentInputTokens={840}
          contextTokens={96_400}
          totalTokens={97_240}
          contextWindow={128_000}
          isCalculating
          isContextCalculating
          pendingContextMessages={3}
          totalContextMessages={12}
          isCompacting
          autoCompactionEnabled
          onAutoCompactionChange={() => undefined}
        >
          <Button variant="light" size="xs">
            Calculating
          </Button>
        </TokenCountMenu>
        <TokenCountMenu
          currentInputTokens={64}
          contextTokens={12_800}
          totalTokens={12_864}
          contextWindowKnown={false}
          autoCompactionEnabled={false}
          onAutoCompactionChange={() => undefined}
        >
          <ActionIcon variant="light" color="chatbox-brand">
            <IconFileZip size={16} />
          </ActionIcon>
        </TokenCountMenu>
      </Group>
    </Stack>
  ),
}

function ImageUploadInputFixture() {
  const ref = useRef<HTMLInputElement>(null)
  const [lastChange, setLastChange] = useState('No file selected')

  return (
    <Stack gap="lg">
      <SurfaceLabel
        title="ImageUploadInput"
        description="Actual hidden file input paired with a visible trigger in the image upload flow."
      />
      <Paper withBorder radius="md" p="md">
        <ImageUploadInput
          ref={ref}
          className=""
          style={{ display: 'block' }}
          accept="image/png, image/jpeg, image/webp"
          multiple
          onChange={(event) => setLastChange(`${event.currentTarget.files?.length ?? 0} file(s) selected`)}
        />
        <Group mt="sm">
          <Button size="xs" variant="light" onClick={() => ref.current?.click()}>
            Trigger input
          </Button>
          <Text size="sm" c="dimmed">
            {lastChange}
          </Text>
        </Group>
      </Paper>
    </Stack>
  )
}

function ToolbarSample({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Group h={32}>{children}</Group>
    </Paper>
  )
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
