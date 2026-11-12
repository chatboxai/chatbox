import { ActionIcon, Text } from '@mantine/core'
import type { MemoryEntry } from '@shared/types/agent-persona'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { SettingsListItem } from '@/components/settings/SettingsLayout'

export function MemoryEntryItem({ entry, onDelete }: { entry: MemoryEntry; onDelete: () => void }) {
  const { t } = useTranslation()
  return (
    <SettingsListItem className="!items-start">
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <Text fz={14} lh="20px" className="whitespace-pre-wrap break-words">
          {entry.content}
        </Text>
        <Text fz={12} lh="18px" c="chatbox-tertiary">
          {new Date(entry.createdAt).toLocaleDateString()}
        </Text>
      </div>
      <ActionIcon variant="subtle" color="chatbox-error" size="sm" aria-label={t('Delete')} onClick={onDelete}>
        <IconTrash size={16} />
      </ActionIcon>
    </SettingsListItem>
  )
}
