import type { BackupSessionSelection } from '@chatbox/react'
import { Badge, Button, Checkbox, Group, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import classes from './BackupExportDialog.module.css'

export function BackupConversationSelector({
  selection,
  disabled,
}: {
  selection: BackupSessionSelection
  disabled: boolean
}) {
  const { t } = useTranslation()
  const allSelected = selection.selectedSessionIds.length === selection.options.length
  return (
    <>
      <TextInput
        leftSection={<IconSearch size={16} />}
        aria-label={String(t('Search conversations'))}
        placeholder={String(t('Search conversations'))}
        value={selection.query}
        disabled={disabled}
        onChange={(event) => selection.setQuery(event.currentTarget.value)}
      />
      <Group justify="flex-end" gap="xs">
        <Button
          size="compact-sm"
          variant="subtle"
          disabled={disabled || selection.isLoading || !!selection.error}
          onClick={() => selection.selectAll(!allSelected)}
        >
          {allSelected ? t('Deselect all conversations') : t('Select all conversations')}
        </Button>
      </Group>
      <div className={classes.list}>
        {selection.isLoading ? (
          <Text p="md" size="sm" c="dimmed">
            {t('Loading conversations...')}
          </Text>
        ) : selection.error ? (
          <Group p="md">
            <Text size="sm" c="red">
              {t('Could not load conversations')}
            </Text>
            <Button size="compact-sm" disabled={disabled} onClick={selection.refresh}>
              {t('Retry')}
            </Button>
          </Group>
        ) : (
          <>
            {selection.visibleOptions.map((option) => (
              <Checkbox.Card
                key={option.id}
                className={classes.row}
                checked={selection.isSelected(option.id)}
                disabled={disabled}
                onClick={() => selection.toggle(option.id)}
                aria-label={option.name}
              >
                <Group wrap="nowrap" gap="sm">
                  <Checkbox.Indicator />
                  <Text size="sm" flex={1} truncate title={option.name}>
                    {option.name}
                  </Text>
                  {(option.archived || option.hidden) && (
                    <Badge size="xs" variant="light" color="gray">
                      {option.archived ? t('Archived') : t('Hidden')}
                    </Badge>
                  )}
                </Group>
              </Checkbox.Card>
            ))}
            {selection.visibleOptions.length === 0 && (
              <Text p="md" size="sm" c="dimmed">
                {t('No conversations found')}
              </Text>
            )}
            {selection.hasMore && (
              <Button fullWidth variant="subtle" disabled={disabled} onClick={selection.showMore}>
                {t('Show more')}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  )
}
