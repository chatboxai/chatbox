import { Flex, Text } from '@mantine/core'
import { IconMessage2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

/**
 * Empty-state placeholder shown when the sidebar tree has no folders and no
 * chats (all archived/hidden). Centered illustration + prompt.
 */
export default function SidebarEmptyState() {
  const { t } = useTranslation()
  return (
    <Flex direction="column" align="center" justify="center" gap="xs" px="md" py="xl" className="select-none">
      <IconMessage2 size={28} className="text-chatbox-tertiary opacity-60" />
      <Text size="sm" c="chatbox-tertiary" ta="center">
        {t('No chats yet')}
      </Text>
    </Flex>
  )
}
