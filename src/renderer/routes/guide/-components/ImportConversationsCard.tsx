import { Box, Button, Stack, Text } from '@mantine/core'
import { IconArrowUpRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'

export function ImportConversationsCard({ onImport, onSkip }: { onImport: () => void; onSkip?: () => void }) {
  const { t } = useTranslation()

  return (
    <Stack gap="xs" maw={320}>
      <Box p="md" className="rounded-lg border border-chatbox-border-brand bg-chatbox-background-brand-secondary">
        <Stack gap="sm">
          <Text size="xs" c="chatbox-brand">
            {t('Chat history import · Optional')}
          </Text>
          <Text fw={600}>{t('Bring your DeepSeek chats to Chatbox')}</Text>
          <Text size="sm" c="chatbox-secondary">
            {t('In the DeepSeek app or website, choose Settings - Data management - Export all conversations.')}
          </Text>
          <Text size="sm" c="chatbox-secondary">
            {t(
              'Have your exported zip file or link (starting with https://deepseek-chat-....) ready, then import it in Settings.'
            )}
          </Text>
          <Button
            variant="light"
            fullWidth
            mih={44}
            rightSection={<ScalableIcon icon={IconArrowUpRight} size={16} />}
            onClick={onImport}
          >
            {t('Go to import')}
          </Button>
        </Stack>
      </Box>
      {onSkip && (
        <>
          <Button variant="default" fullWidth mih={44} onClick={onSkip}>
            {t('No need to import')}
          </Button>
          <Text size="xs" c="chatbox-secondary" ta="center">
            {t('You can also import later in Settings → Data & Backup.')}
          </Text>
        </>
      )}
    </Stack>
  )
}
