import { Box, Group, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReasoningInlineSummary } from '../message-parts/ReasoningInlineSummary'

const meta: Meta<typeof ReasoningInlineSummary> = {
  title: 'Real Components/ReasoningInlineSummary',
  component: ReasoningInlineSummary,
  decorators: [
    (Story, context) => (
      <Box p="lg" style={{ width: 360 }}>
        <Group gap={6} wrap="nowrap" style={{ width: '100%' }}>
          <Text component="span" size="sm" c="chatbox-tertiary" fs="italic" style={{ flex: 'none' }}>
            {context.args.isThinking ? 'Thinking' : 'Thought'}
          </Text>
          <Story />
        </Group>
      </Box>
    ),
  ],
}

export default meta

export const Streaming: StoryObj<typeof ReasoningInlineSummary> = {
  args: {
    content:
      'I should first identify the relevant message-rendering path.\nNow I am comparing the streaming behavior and keeping the newest reasoning tokens visible at the right edge.',
    isThinking: true,
  },
}

export const Completed: StoryObj<typeof ReasoningInlineSummary> = {
  args: {
    content:
      'I should first identify the relevant message-rendering path.\nThen I can keep the complete reasoning available in the expanded disclosure.',
    isThinking: false,
  },
}
