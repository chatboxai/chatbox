import { Box, Button, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconAlertCircle, IconArrowUpRight, IconWorldOff } from '@tabler/icons-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ChatboxAIErrorMessage } from '@/components/common/ChatboxAIErrorMessage'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

interface ToolUnavailableCardProps {
  toolLabel: string
  toolName: string
  errorCode: number
}

const CHATBOX_SEARCH_LICENSE_REQUIRED = 20024

async function openSettings(path?: string): Promise<void> {
  const { navigateToSettings } = await import('@/modals/settings-navigation')
  if (path) {
    navigateToSettings(path)
  } else {
    navigateToSettings()
  }
}

export const ToolUnavailableCard: FC<ToolUnavailableCardProps> = ({ toolLabel, toolName, errorCode }) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const isChatboxSearchSignInRequired = toolName === 'web_search' && errorCode === CHATBOX_SEARCH_LICENSE_REQUIRED
  const ToolErrorIcon = toolName === 'web_search' || toolName === 'parse_link' ? IconWorldOff : IconAlertCircle

  return (
    <Paper
      role="status"
      radius={8}
      p={isSmallScreen ? 14 : 16}
      withBorder
      style={{
        borderColor: 'var(--chatbox-border-primary)',
        background: 'var(--chatbox-background-primary)',
      }}
    >
      <Group
        align="flex-start"
        wrap="nowrap"
        gap={isSmallScreen ? 10 : 14}
        style={isSmallScreen ? { flexDirection: 'column' } : undefined}
      >
        <ThemeIcon
          size={38}
          radius="50%"
          variant="light"
          style={{
            flexShrink: 0,
            color: 'var(--chatbox-tint-error)',
            background: 'var(--chatbox-background-error-secondary)',
          }}
        >
          <ToolErrorIcon size={20} stroke={1.8} />
        </ThemeIcon>

        <Box style={{ flex: 1, minWidth: 0, width: isSmallScreen ? '100%' : undefined }}>
          <Stack gap={4}>
            <Text size="sm" fw={600} lh={1.45}>
              {isChatboxSearchSignInRequired
                ? t('Web Search was not run: sign in to use Chatbox AI Search')
                : t('{{tool}} could not run', { tool: toolLabel })}
            </Text>
            <Text size="13px" c="var(--chatbox-tint-secondary)" lh={1.6} component="div">
              {isChatboxSearchSignInRequired ? (
                t(
                  'Chatbox AI Search is built in and does not require an API key. Sign in to use web search and webpage reading. No web results were used in this response.'
                )
              ) : (
                <ChatboxAIErrorMessage errorCode={errorCode} trackingSource="msg_tool_error" />
              )}
            </Text>
          </Stack>

          {isChatboxSearchSignInRequired && (
            <Group mt={10} gap={8} align="stretch" style={isSmallScreen ? { flexDirection: 'column' } : undefined}>
              <Button
                h={isSmallScreen ? 40 : 32}
                px={14}
                radius={6}
                size="xs"
                fullWidth={isSmallScreen}
                rightSection={<IconArrowUpRight size={14} stroke={2} />}
                onClick={() => void openSettings()}
                style={{
                  fontWeight: 600,
                  color: 'var(--chatbox-tint-white)',
                  background: 'var(--chatbox-background-brand-primary)',
                }}
              >
                {t('Sign in to Chatbox AI')}
              </Button>
              <Button
                h={isSmallScreen ? 40 : 32}
                px={14}
                radius={6}
                size="xs"
                fullWidth={isSmallScreen}
                variant="light"
                onClick={() => void openSettings('/web-search')}
              >
                {t('Web Search settings')}
              </Button>
            </Group>
          )}
        </Box>
      </Group>
    </Paper>
  )
}
