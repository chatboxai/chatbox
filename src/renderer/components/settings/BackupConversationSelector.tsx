import { Badge, Button, Checkbox, Group, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import classes from './BackupConversationSelector.module.css'

export interface BackupConversationOption {
  id: string
  name: string
  selected: boolean
  archived?: boolean
  hidden?: boolean
}

/** Displays the supplied page; selection and catalog loading belong to the caller. */
export function BackupConversationSelector({
  options,
  query,
  allSelected,
  isLoading,
  error,
  hasMore,
  disabled = false,
  onQueryChange,
  onSelectAll,
  onToggle,
  onLoadMore,
  onRetry,
}: {
  options: readonly BackupConversationOption[]
  query: string
  allSelected: boolean
  isLoading: boolean
  error?: string
  hasMore: boolean
  disabled?: boolean
  onQueryChange(query: string): void
  onSelectAll(selected: boolean): void
  onToggle(id: string): void
  onLoadMore(): void
  onRetry(): void
}) {
  const { t } = useTranslation()
  return (
    <>
      <TextInput
        leftSection={<IconSearch size={16} />}
        aria-label={String(t('Search conversations'))}
        placeholder={String(t('Search conversations'))}
        value={query}
        disabled={disabled}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <Group justify="flex-end" gap="xs">
        <Button
          size="compact-sm"
          variant="subtle"
          disabled={disabled || isLoading || !!error}
          onClick={() => onSelectAll(!allSelected)}
        >
          {allSelected ? t('Deselect all conversations') : t('Select all conversations')}
        </Button>
      </Group>
      <div className={classes.list}>
        {options.map((option) => (
          <Checkbox.Card
            key={option.id}
            className={classes.row}
            checked={option.selected}
            disabled={disabled}
            onClick={() => onToggle(option.id)}
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
        {error ? (
          <Group p="md">
            <Text size="sm" c="red">
              {error}
            </Text>
            <Button size="compact-sm" disabled={disabled || isLoading} onClick={onRetry}>
              {t('Retry')}
            </Button>
          </Group>
        ) : isLoading ? (
          <Text p="md" size="sm" c="dimmed">
            {t('Loading conversations...')}
          </Text>
        ) : options.length === 0 ? (
          <Text p="md" size="sm" c="dimmed">
            {t('No conversations found')}
          </Text>
        ) : null}
        {hasMore && !error && (
          <Button fullWidth variant="subtle" disabled={disabled || isLoading} onClick={onLoadMore}>
            {t('Show more')}
          </Button>
        )}
      </div>
    </>
  )
}
