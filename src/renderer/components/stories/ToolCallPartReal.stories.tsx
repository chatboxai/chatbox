import { Box, Stack, Text } from '@mantine/core'
import { SANDBOX_EXEC_ERROR_CODES } from '@shared/sandbox-provider'
import type { Message, MessageToolCallPart } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { type StepTimelinePart, StepTimelineUI, ToolCallPartUI } from '../message-parts/ToolCallPartUI'

// ─── ToolCallPartUI Stories ─────────────────────────────────────────

const toolCallMeta: Meta<typeof ToolCallPartUI> = {
  title: 'Real Components/ToolCallPartUI',
  component: ToolCallPartUI,
  parameters: {
    docs: {
      description: {
        component:
          'The actual `ToolCallPartUI` component from `src/renderer/components/message-parts/ToolCallPartUI.tsx`. ' +
          'Renders tool call status as a compact pill with expandable details.',
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

export default toolCallMeta

// ─── Mock Data Factories ────────────────────────────────────────────

function makeToolCallPart(overrides: Record<string, unknown> = {}): MessageToolCallPart {
  return {
    type: 'tool-call' as const,
    state: 'result' as const,
    toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
    toolName: 'web_search',
    args: {},
    ...overrides,
  } as MessageToolCallPart
}

// ─── Stories ────────────────────────────────────────────────────────

export const WebSearchLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'call',
      args: { query: 'React Server Components vs SSR' },
    }),
  },
}

export const WebSearchSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'result',
      args: { query: 'React Server Components vs SSR' },
      result: {
        query: 'React Server Components vs SSR',
        searchResults: [
          {
            title: 'Understanding React Server Components',
            snippet: 'React Server Components allow rendering on the server without sending JS to the client...',
            link: 'https://example.com/react-rsc',
          },
          {
            title: 'SSR vs RSC: What is the difference?',
            snippet: 'While SSR renders the full page on the server, RSC allows component-level server rendering...',
            link: 'https://example.com/ssr-vs-rsc',
          },
          {
            title: 'Next.js App Router and Server Components',
            snippet: 'The App Router in Next.js 13+ uses React Server Components by default for all pages...',
            link: 'https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-the-card-grew-with-its-content/nextjs-app-router?token=abcdefghijklmnopqrstuvwxyz0123456789',
          },
        ],
      },
    }),
  },
}

export const WebSearchError: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Error',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'error',
      args: { query: 'React Server Components' },
    }),
  },
}

export const CodeSearchSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Code Search — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'code_search',
      state: 'result',
      args: { query: 'useEffect cleanup' },
      result: { matches: 3 },
    }),
  },
}

export const KnowledgeBaseLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Knowledge Base — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'query_knowledge_base',
      state: 'call',
      args: { query: 'authentication flow' },
    }),
  },
}

export const TerminalSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Terminal — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'terminal',
      state: 'result',
      args: { command: 'ls -la' },
      result: { output: 'total 48\ndrwxr-xr-x  12 user  staff  384 Mar  5 10:00 .\n...' },
    }),
  },
}

export const BashNotAvailable: StoryObj<typeof ToolCallPartUI> = {
  name: 'Code Execution — Bash Not Available',
  args: {
    part: makeToolCallPart({
      toolName: 'code_execution',
      state: 'result',
      args: { language: 'bash', code: 'echo hello' },
      result: {
        stdout: '',
        stderr: 'bash is not available on this Windows host. Install Git Bash or enable WSL, or use node.',
        exitCode: 127,
        errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE,
      },
    }),
  },
}

export const ReadFileSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Read File — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'read_file',
      state: 'result',
      args: { path: 'src/index.ts' },
      result: { content: 'import { app } from "electron"\n...' },
    }),
  },
}

export const ReadFileBashNotAvailable: StoryObj<typeof ToolCallPartUI> = {
  name: 'Read File — Bash Not Available',
  args: {
    part: makeToolCallPart({
      toolName: 'read_file',
      state: 'result',
      args: { file_path: 'report.txt' },
      result: {
        error: 'bash is not available on this Windows host.',
        errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE,
      },
    }),
  },
}

export const ParseLinkLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Parse Link — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'parse_link',
      state: 'call',
      args: { url: 'https://example.com/article' },
    }),
  },
}

export const ParseLinkSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Parse Link — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'parse_link',
      state: 'result',
      args: {
        url: 'https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-unwrapped?token=abcdefghijklmnopqrstuvwxyz0123456789',
      },
      result: {
        url: 'https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-unwrapped?token=abcdefghijklmnopqrstuvwxyz0123456789',
        title: 'Understanding React Server Components',
        content:
          'React Server Components allow rendering on the server without sending JS to the client.\n\nSee also https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-unwrapped?token=abcdefghijklmnopqrstuvwxyz0123456789',
      },
    }),
  },
}

// ─── Step Timeline (reasoning + tool calls on one connected line) ───

function makeMessage(parts: StepTimelinePart[], overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_demo',
    role: 'assistant',
    contentParts: parts,
    isStreamingMode: true,
    generating: false,
    ...overrides,
  } as Message
}

export const StepTimelineReasoningAndTools: StoryObj = {
  name: 'Step Timeline — Reasoning + Tools',
  parameters: {
    docs: {
      description: {
        story:
          'Consecutive thinking and tool-call steps thread together on a single connected timeline. ' +
          'Each step shows how long it took (durations under 2s are hidden).',
      },
    },
  },
  render: () => {
    const parts: StepTimelinePart[] = [
      {
        type: 'reasoning',
        text: 'Let me break the task down and decide which files to inspect first.',
        duration: 4200,
      },
      makeToolCallPart({
        toolName: 'web_search',
        state: 'result',
        args: { query: 'token refresh best practices' },
        duration: 3300,
        result: {
          query: 'token refresh best practices',
          searchResults: [
            {
              title: 'OAuth token refresh patterns',
              snippet: 'How to rotate refresh tokens…',
              link: 'https://example.com/docs/very-long-path/that-has-no-spaces-and-would-overflow-the-viewport-if-the-card-grew-with-its-content/oauth?token=abcdefghijklmnopqrstuvwxyz0123456789',
            },
            {
              title: 'Silent refresh in SPAs',
              snippet: 'Refreshing access tokens without a redirect…',
              link: 'https://example.com/spa',
            },
          ],
        },
      }),
      makeToolCallPart({ toolName: 'file_search', state: 'result', args: { query: 'auth flow' }, duration: 1200 }),
      makeToolCallPart({ toolName: 'read_file', state: 'result', args: { path: 'src/auth.ts' }, duration: 2600 }),
      { type: 'reasoning', text: 'The token refresh looks wrong — verifying with a quick command.', duration: 3100 },
      makeToolCallPart({ toolName: 'terminal', state: 'result', args: { command: 'npm test auth' }, duration: 8400 }),
    ]
    return <StepTimelineUI parts={parts} message={makeMessage(parts)} onCopyReasoningContent={() => () => {}} />
  },
}

export const StepTimelineWithInterleavedText: StoryObj = {
  name: 'Step Timeline — Interleaved Text',
  parameters: {
    docs: {
      description: {
        story:
          'Intermediate narration the assistant emits between steps is threaded into the same timeline ' +
          '(so the whole run stays connected and collapses together); only the final answer stays outside.',
      },
    },
  },
  render: () => {
    const parts: StepTimelinePart[] = [
      { type: 'reasoning', text: 'First I need to find where auth is handled.', duration: 3200 },
      { type: 'text', text: 'Let me search the codebase for the auth flow.' },
      makeToolCallPart({ toolName: 'file_search', state: 'result', args: { query: 'auth' }, duration: 2400 }),
      { type: 'text', text: "Found it in `src/auth.ts`. I'll read it to confirm the token logic." },
      makeToolCallPart({ toolName: 'read_file', state: 'result', args: { path: 'src/auth.ts' }, duration: 2100 }),
    ]
    return (
      <StepTimelineUI
        parts={parts}
        message={makeMessage(parts)}
        onCopyReasoningContent={() => () => {}}
        renderText={(part) => <Text size="sm">{part.text}</Text>}
      />
    )
  },
}

export const StepTimelineRunning: StoryObj = {
  name: 'Step Timeline — Running',
  render: () => {
    const parts: StepTimelinePart[] = [
      { type: 'reasoning', text: 'Planning the change…', duration: 3500 },
      makeToolCallPart({ toolName: 'edit_file', state: 'result', args: { path: 'src/index.ts' }, duration: 2100 }),
      makeToolCallPart({ toolName: 'terminal', state: 'call', args: { command: 'pnpm build' }, startTime: Date.now() }),
    ]
    return <StepTimelineUI parts={parts} message={makeMessage(parts, { generating: true })} />
  },
}

export const StepTimelinePausedAtStepLimit: StoryObj = {
  name: 'Step Timeline — Paused at Step Limit',
  parameters: {
    docs: {
      description: {
        story:
          'After a run of consecutive tool calls the generation pauses for confirmation. The paused step stays ' +
          'collapsed and read-only here; Continue/Stop and the "don\'t pause again" options render in the ' +
          'pending-action bar above the input box (see the PendingActionBar stories).',
      },
    },
  },
  render: () => {
    const parts: StepTimelinePart[] = [
      { type: 'reasoning', text: 'Still working through the long task…', duration: 2600 },
      makeToolCallPart({ toolName: 'read_file', state: 'result', args: { path: 'src/auth.ts' }, duration: 2100 }),
      makeToolCallPart({
        toolName: 'code_execution',
        state: 'paused',
        args: { language: 'bash', code: 'pnpm test' },
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
        stepIndex: 25,
      }),
    ]
    return <StepTimelineUI parts={parts} message={makeMessage(parts)} sessionId="session_demo" messageId="msg_demo" />
  },
}

export const MultiplePills: StoryObj = {
  name: 'Multiple Tool Calls',
  render: () => (
    <Stack gap="xs">
      <Text size="sm" c="dimmed" mb="xs">
        Multiple tool calls in a single message:
      </Text>
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'web_search',
          state: 'result',
          args: { query: 'React hooks best practices' },
          result: {
            query: 'React hooks best practices',
            searchResults: [
              { title: 'React Hooks Guide', snippet: 'Best practices for hooks...', link: 'https://example.com' },
            ],
          },
        })}
      />
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'read_file',
          state: 'result',
          args: { path: 'package.json' },
          result: { content: '{ "name": "chatbox" }' },
        })}
      />
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'terminal',
          state: 'call',
          args: { command: 'npm test' },
        })}
      />
    </Stack>
  ),
}
