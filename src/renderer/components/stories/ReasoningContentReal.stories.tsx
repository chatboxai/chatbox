import { Box } from '@mantine/core'
import type { Message, MessageReasoningPart } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type React from 'react'
import { ReasoningContentUI } from '../message-parts/ToolCallPartUI'

const meta: Meta<typeof ReasoningContentUI> = {
  title: 'Real Components/ReasoningContentUI',
  component: ReasoningContentUI,
  parameters: {
    docs: {
      description: {
        component:
          'The actual `ReasoningContentUI` component from `src/renderer/components/message-parts/ToolCallPartUI.tsx`. ' +
          'Renders reasoning/thinking content in a minimal inline style with expandable detail.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box p="lg" style={{ maxWidth: 600 }}>
        <Story />
      </Box>
    ),
  ],
}

export default meta

// ─── Mock Data Factories ────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: MessageRoleEnum.Assistant,
    contentParts: [],
    tokenCalculatedAt: 0,
    ...overrides,
  } as Message
}

function makeReasoningPart(overrides: Partial<MessageReasoningPart> = {}): MessageReasoningPart {
  return {
    type: 'reasoning',
    text: '',
    ...overrides,
  } as MessageReasoningPart
}

const noop = (_content: string) => (_e: React.MouseEvent<HTMLButtonElement>) => {}

// ─── Stories ────────────────────────────────────────────────────────

export const ActivelyThinking: StoryObj<typeof ReasoningContentUI> = {
  name: 'Actively Thinking',
  args: (() => {
    // Share the same part reference so the component's `===` identity check detects "actively thinking"
    const part = makeReasoningPart({
      text: 'I should first identify the relevant message-rendering path.\nNow I am comparing the streaming behavior and keeping the newest reasoning tokens visible at the right edge.',
      startTime: Date.now() - 3200,
    })
    return {
      message: makeMessage({
        generating: true,
        isStreamingMode: true,
        contentParts: [part],
      }),
      part,
      onCopyReasoningContent: noop,
    }
  })(),
}

export const CompletedWithContent: StoryObj<typeof ReasoningContentUI> = {
  name: 'Completed — With Reasoning Content',
  args: {
    message: makeMessage({
      generating: false,
      isStreamingMode: true,
      contentParts: [],
    }),
    part: makeReasoningPart({
      text: 'The user is asking about React Server Components. I should explain the key differences between RSC and traditional client-side rendering, focusing on:\n\n1. Where the code executes (server vs browser)\n2. Bundle size implications\n3. Data fetching patterns\n4. When to use each approach\n\nLet me provide a clear, structured response.',
      duration: 5400,
    }),
    onCopyReasoningContent: noop,
  },
}

export const CompletedWithDuration: StoryObj<typeof ReasoningContentUI> = {
  name: 'Completed — With Duration Timer',
  args: {
    message: makeMessage({
      generating: false,
      isStreamingMode: true,
    }),
    part: makeReasoningPart({
      text: 'This is a complex question about distributed systems. Let me think through the CAP theorem implications and how they relate to the specific architecture being discussed.\n\nThe trade-offs between consistency and availability in this context suggest that an eventually consistent approach would be most appropriate.',
      duration: 15700,
    }),
    onCopyReasoningContent: noop,
  },
}

export const CompletedNoStreamingMode: StoryObj<typeof ReasoningContentUI> = {
  name: 'Completed — No Streaming Mode (no timer)',
  args: {
    message: makeMessage({
      generating: false,
      isStreamingMode: false,
    }),
    part: makeReasoningPart({
      text: 'Reasoning content from a non-streaming response. The timer is not shown in this mode.',
      duration: 2000,
    }),
    onCopyReasoningContent: noop,
  },
}

export const EmptyReasoningContent: StoryObj<typeof ReasoningContentUI> = {
  name: 'Completed — Empty Content',
  args: {
    message: makeMessage({
      generating: false,
      isStreamingMode: true,
    }),
    part: makeReasoningPart({
      text: '',
      duration: 1200,
    }),
    onCopyReasoningContent: noop,
  },
}
