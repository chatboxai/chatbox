import { Box, Stack, Text } from '@mantine/core'
import { MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import type { Meta, StoryObj } from '@storybook/react-vite'
import MessageErrTips from '../chat/MessageErrTips'

const meta: Meta<typeof MessageErrTips> = {
  title: 'Real Components/MessageErrTips',
  component: MessageErrTips,
  parameters: {
    docs: {
      description: {
        component:
          'The actual `MessageErrTips` component from `src/renderer/components/chat/MessageErrTips.tsx`. ' +
          'Renders error messages with retry button, expandable details, and context-specific suggestions.',
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

// ─── Mock Data Factory ──────────────────────────────────────────────

function makeErrorMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: MessageRoleEnum.Assistant,
    contentParts: [],
    tokenCalculatedAt: 0,
    error: 'Something went wrong',
    ...overrides,
  } as Message
}

// ─── Stories ────────────────────────────────────────────────────────

export const GenericError: StoryObj<typeof MessageErrTips> = {
  name: 'Generic Error',
  args: {
    msg: makeErrorMessage({
      error: 'An unexpected error occurred while processing your request.',
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const CompactError: StoryObj<typeof MessageErrTips> = {
  name: 'Generic Error — Compact Width',
  decorators: [
    (Story) => (
      <Box maw={320}>
        <Story />
      </Box>
    ),
  ],
  args: {
    msg: makeErrorMessage({
      error: 'An unexpected error occurred while processing your request.',
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const QuotaExhaustedReminder: StoryObj<typeof MessageErrTips> = {
  name: 'Quota Exhausted — Reminder Card',
  args: {
    msg: makeErrorMessage({
      error: 'Token Quota Exhausted',
      errorCode: 10004,
    }),
  },
}

export const FreeQuotaExhaustedReminder: StoryObj<typeof MessageErrTips> = {
  name: 'Free Daily Quota Exhausted — Reminder Card',
  args: {
    msg: makeErrorMessage({
      error: 'Free Token Quota Exhausted',
      errorCode: 20039,
    }),
  },
}

export const OcrQuotaExhaustedReminder: StoryObj<typeof MessageErrTips> = {
  name: 'Chatbox AI OCR Quota Exhausted — Reminder Card',
  args: {
    msg: makeErrorMessage({
      error: 'OCR Error (Chatbox AI): Token Quota Exhausted',
      errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED,
      aiProvider: 'deepseek',
      model: 'DeepSeek API (DeepSeek V4 Pro)',
      errorExtra: { aiProvider: 'Chatbox AI', causeErrorCode: 10004 },
    }),
  },
}

export const FreeOcrQuotaExhaustedReminder: StoryObj<typeof MessageErrTips> = {
  name: 'Chatbox AI OCR Free Daily Quota Exhausted — Reminder Card',
  args: {
    msg: makeErrorMessage({
      error: 'OCR Error (Chatbox AI): Free Token Quota Exhausted',
      errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED,
      aiProvider: 'deepseek',
      model: 'DeepSeek API (DeepSeek V4 Pro)',
      errorExtra: { aiProvider: 'Chatbox AI', causeErrorCode: 20039 },
    }),
  },
}

export const AgentModeRewardReminder: StoryObj<typeof MessageErrTips> = {
  name: 'Agent Mode Reward — Reminder Card',
  args: {
    msg: makeErrorMessage({
      error: 'Free Agent Mode Token Quota Exhausted',
      errorCode: 20040,
    }),
    onRetry: () => alert('Continue task'),
  },
}

export const NetworkError: StoryObj<typeof MessageErrTips> = {
  name: 'Network Error (fetch failed)',
  args: {
    msg: makeErrorMessage({
      error: 'Network Error: fetch failed',
      errorExtra: { host: 'api.openai.com' },
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const RateLimitError: StoryObj<typeof MessageErrTips> = {
  name: 'Rate Limit Error (429)',
  args: {
    msg: makeErrorMessage({
      error: 'API Error: Status Code 429, Rate limit exceeded.',
      aiProvider: 'openai',
      errorExtra: { httpStatusCode: 429 },
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const AuthError: StoryObj<typeof MessageErrTips> = {
  name: 'Auth Error (401)',
  args: {
    msg: makeErrorMessage({
      error: 'API Error: Status Code 401, Invalid API key.',
      aiProvider: 'openai',
      errorExtra: { httpStatusCode: 401 },
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const ContextLengthError: StoryObj<typeof MessageErrTips> = {
  name: 'Context Length Error',
  args: {
    msg: makeErrorMessage({
      error:
        "API Error: This model's maximum context length is 8192 tokens. However, your messages resulted in context_length_exceeded 12450 tokens.",
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const ServerError: StoryObj<typeof MessageErrTips> = {
  name: 'Server Error (500)',
  args: {
    msg: makeErrorMessage({
      error: 'API Error: Status Code 500, Internal server error',
      aiProvider: 'openai',
      errorExtra: { httpStatusCode: 500 },
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const LongErrorWithResponseBody: StoryObj<typeof MessageErrTips> = {
  name: 'Long Error with Response Body',
  args: {
    msg: makeErrorMessage({
      error: 'API Error: Status Code 502, Bad Gateway',
      aiProvider: 'openai',
      errorExtra: {
        httpStatusCode: 502,
        responseBody:
          'Bad Gateway: The server received an invalid response from the upstream server. This is typically a transient issue. Request ID: req_abc123def456. Timestamp: 2024-03-05T10:00:00Z. If this error persists, please contact support with the request ID.',
      },
    }),
    onRetry: () => alert('Retry clicked'),
  },
}

export const WithoutRetry: StoryObj<typeof MessageErrTips> = {
  name: 'Error Without Retry Button',
  args: {
    msg: makeErrorMessage({
      error: 'Your subscription has expired. Please renew to continue.',
      errorCode: 403,
    }),
  },
}

export const MultipleErrors: StoryObj = {
  name: 'Multiple Error Types Comparison',
  render: () => (
    <Stack gap="lg">
      {[
        { label: 'Network Error', error: 'Network Error: fetch failed', extra: { host: 'api.openai.com' } },
        {
          label: '401 Unauthorized',
          error: 'API Error: Status Code 401, Invalid API key',
          extra: { httpStatusCode: 401 },
        },
        {
          label: '429 Rate Limit',
          error: 'API Error: Status Code 429, Rate limit exceeded',
          extra: { httpStatusCode: 429 },
        },
        {
          label: '500 Server Error',
          error: 'API Error: Status Code 500, Internal server error',
          extra: { httpStatusCode: 500 },
        },
        {
          label: 'Context Length',
          error:
            "API Error: This model's maximum context length is 8192 tokens, context_length_exceeded. You sent 12450 tokens.",
        },
      ].map(({ label, error, extra }) => (
        <Box key={label}>
          <Text size="xs" c="dimmed" mb={4} fw={600}>
            {label}
          </Text>
          <MessageErrTips
            msg={makeErrorMessage({ error, aiProvider: 'openai', errorExtra: extra })}
            onRetry={() => alert(`Retry: ${label}`)}
          />
        </Box>
      ))}
    </Stack>
  ),
}
