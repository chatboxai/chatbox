import { Box, Text } from '@mantine/core'
import type { Message, MessageToolCallPart, Session } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PendingActionBar from '../InputBox/PendingActionBar'
import { StepTimelineUI } from '../message-parts/ToolCallPartUI'

const storyQueryClient = new QueryClient()

// Simulates the session layout: paused steps stay collapsed in the message list
// while all decisions render in the unified pending-action bar. Every pause locks
// the input, so the bar takes over its slot.

const commandApprovalPart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'paused',
  toolCallId: 'story-approval-command',
  toolName: 'user_exec',
  args: { command: 'agent-reach doctor --json' },
  pauseReason: {
    type: 'user_exec_approval',
    command: 'agent-reach doctor --json',
    workdir: '/Users/demo/workspace/agent-project',
    explanation:
      '该命令运行 agent-reach 的诊断检查并输出 JSON 结果，与用户抓取 SpaceX 新闻的需求不符，可能产生副作用或执行未知代码，需人工审查。',
  },
} as MessageToolCallPart

const escalationApprovalPart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'paused',
  toolCallId: 'story-approval-escalation',
  toolName: 'user_exec',
  args: { command: 'pnpm test --runInBand' },
  pauseReason: {
    type: 'command_escalation_approval',
    command: 'pnpm test --runInBand',
    workdir: '/Users/demo/workspace/agent-project',
    justification: '沙箱内没有网络权限，测试无法访问本地服务，需要完全访问权限重试。',
  },
} as MessageToolCallPart

const fileApprovalPart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'paused',
  toolCallId: 'story-approval-file',
  toolName: 'edit_file',
  args: { path: 'src/config.ts' },
  pauseReason: {
    type: 'file_mutation_approval',
    title: 'Edit src/config.ts',
    preview: '',
    stats: { mode: 'edit', edits: 1, addedLines: 1, removedLines: 1 },
  },
} as MessageToolCallPart

const imageApprovalPart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'paused',
  toolCallId: 'story-approval-image',
  toolName: 'generate_image',
  args: {},
  pauseReason: {
    type: 'app_action_approval',
    action: 'image.generate',
    title: 'Generate images',
    preview: '猎鹰 9 号夜间发射，长曝光轨迹',
    details: {
      type: 'image_generation',
      provider: 'chatbox-ai',
      modelId: 'gpt-image-1',
      prompt: '猎鹰 9 号夜间发射，长曝光轨迹',
      count: 2,
      aspectRatio: '16:9',
      billing: 'chatbox_quota',
      imageQuota: { remaining: 48, total: 200 },
      computePointsRemainingRatio: 0.62,
    },
  },
} as MessageToolCallPart

const limitPausePart: MessageToolCallPart = {
  type: 'tool-call',
  state: 'paused',
  toolCallId: 'story-limit-pause',
  toolName: 'sandbox_bash',
  args: { command: 'pnpm test' },
  pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
} as MessageToolCallPart

function makeSession(parts: MessageToolCallPart[]): { session: Session; message: Message } {
  const message = {
    id: 'story-message',
    role: 'assistant',
    contentParts: parts,
  } as unknown as Message
  const session = {
    id: 'story-session',
    type: 'chat',
    name: 'Pending action bar story',
    messages: [message],
  } as unknown as Session
  return { session, message }
}

const meta: Meta<typeof PendingActionBar> = {
  title: 'Real Components/PendingActionBar',
  component: PendingActionBar,
  decorators: [
    (Story) => (
      <QueryClientProvider client={storyQueryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
}

export default meta

function SessionLayout({ parts }: { parts: MessageToolCallPart[] }) {
  const { session, message } = makeSession(parts)
  return (
    <Box style={{ height: 560, maxWidth: 720, display: 'flex', flexDirection: 'column', margin: '0 auto' }}>
      <Box style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <Text size="sm" c="chatbox-tertiary" mb={8}>
          （消息流：暂停步骤保持折叠，点击可查看只读详情；操作在下方交互条完成）
        </Text>
        <StepTimelineUI
          parts={parts}
          message={message}
          sessionId={session.id}
          messageId={message.id}
          onCopyReasoningContent={() => () => {}}
        />
      </Box>
      <Box style={{ padding: '0 16px 16px' }}>
        <PendingActionBar session={session} />
      </Box>
    </Box>
  )
}

export const MultipleApprovals: StoryObj = {
  name: 'Multiple approvals (1/N progress)',
  render: () => <SessionLayout parts={[commandApprovalPart, fileApprovalPart]} />,
}

export const CommandEscalation: StoryObj = {
  name: 'Command escalation',
  render: () => <SessionLayout parts={[escalationApprovalPart]} />,
}

export const FileMutation: StoryObj = {
  name: 'File mutation (tinted preview)',
  render: () => <SessionLayout parts={[fileApprovalPart]} />,
}

export const ImageGeneration: StoryObj = {
  name: 'Image generation',
  render: () => <SessionLayout parts={[imageApprovalPart]} />,
}

export const ToolCallLimitPause: StoryObj = {
  name: 'Tool-call limit pause',
  render: () => <SessionLayout parts={[limitPausePart]} />,
}
