import { ActionIcon, Button, Divider, Flex, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import type { CommandApprovalMode } from '@shared/types'
import { IconCheck, IconFile, IconFolder, IconTrash } from '@tabler/icons-react'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { getDirectoryName } from './useAgentModeSettingsState'

// Shared option rows between the Work Mode panel's Code Execution sub-page and the
// composer status chip menu, so the two entry points always look and behave the same.
export const CommandApprovalOptions: FC<{
  mode: CommandApprovalMode
  disabled?: boolean
  onSelect: (mode: CommandApprovalMode) => void
}> = ({ mode, disabled = false, onSelect }) => {
  const { t } = useTranslation()
  return (
    <>
      <Flex
        justify="space-between"
        align="center"
        px="sm"
        py={6}
        gap="sm"
        className={`rounded ${
          disabled
            ? 'cursor-default opacity-50'
            : 'cursor-pointer hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
        }`}
        onClick={() => {
          if (disabled) return
          onSelect('always_ask')
        }}
      >
        <Stack gap={0} className="min-w-0">
          <Text size="sm" c={mode === 'always_ask' ? 'chatbox-brand' : undefined}>
            {t('Always Ask')}
          </Text>
          <Text size="xs" c="chatbox-secondary" className="leading-snug">
            {t('Ask before every command that needs host access.')}
          </Text>
        </Stack>
        {mode === 'always_ask' && <IconCheck size={14} className="text-[var(--chatbox-tint-brand)] shrink-0" />}
      </Flex>
      <Flex
        justify="space-between"
        align="center"
        px="sm"
        py={6}
        gap="sm"
        className={`rounded ${
          disabled
            ? 'cursor-default opacity-50'
            : 'cursor-pointer hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
        }`}
        onClick={() => {
          if (disabled) return
          onSelect('smart')
        }}
      >
        <Stack gap={0} className="min-w-0">
          <Text size="sm" c={mode === 'smart' ? 'chatbox-brand' : undefined}>
            {t('Smart Approval')}
          </Text>
          <Text size="xs" c="chatbox-secondary" className="leading-snug">
            {t('Automatically approve safe commands and ask when uncertain.')}
          </Text>
        </Stack>
        {mode === 'smart' && <IconCheck size={14} className="text-[var(--chatbox-tint-brand)] shrink-0" />}
      </Flex>
      <Flex
        justify="space-between"
        align="center"
        px="sm"
        py={6}
        gap="sm"
        className={`rounded ${
          disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30'
        }`}
        onClick={() => {
          if (disabled) return
          onSelect('full_access')
        }}
      >
        <Stack gap={0} className="min-w-0">
          <Text size="sm" c="red" fw={500}>
            {t('Full Access')}
          </Text>
          <Text size="xs" c="red" className="leading-snug">
            {t('Skip approval prompts for commands and file changes, and run without periodic step confirmations.')}
          </Text>
        </Stack>
        {mode === 'full_access' && <IconCheck size={14} className="text-red-600 shrink-0" />}
      </Flex>
    </>
  )
}

// Shared body between the Work Mode panel's Working Directory sub-page and the
// composer status chip menu: description, bound list, recent list, add button.
export const WorkingDirectoryContent: FC<{
  workingDirectories: string[]
  availableRecentDirectories: string[]
  disabled?: boolean
  onRemove: (dir: string) => void
  onSelectRecent: (dir: string) => void
  onAdd: () => void
}> = ({ workingDirectories, availableRecentDirectories, disabled = false, onRemove, onSelectRecent, onAdd }) => {
  const { t } = useTranslation()
  return (
    <>
      <Text size="xs" c="dimmed" px="sm" pb={4}>
        {t('Grant the agent read/write access to local folders without per-action approval.')}
      </Text>
      {workingDirectories.map((dir) => (
        <Flex key={dir} justify="space-between" align="center" px="sm" py={6} gap="xs">
          <Flex gap="xs" align="center" className="min-w-0">
            <IconFile size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
            <Tooltip label={dir} withArrow position="right" openDelay={400}>
              <Text size="sm" truncate className="min-w-0">
                {getDirectoryName(dir)}
              </Text>
            </Tooltip>
          </Flex>
          <ActionIcon
            variant="subtle"
            size={20}
            color="red"
            disabled={disabled}
            aria-label={t('Remove')}
            onClick={() => {
              if (disabled) return
              onRemove(dir)
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Flex>
      ))}
      {availableRecentDirectories.length > 0 && (
        <>
          <Divider my={4} mx="sm" label={t('Recent')} labelPosition="left" />
          {availableRecentDirectories.map((dir) => (
            <UnstyledButton
              key={dir}
              className={`w-full rounded px-3 py-1.5 text-left ${
                disabled
                  ? 'cursor-default opacity-50'
                  : 'hover:bg-[var(--mantine-color-gray-0)] dark:hover:bg-[var(--mantine-color-dark-5)]'
              }`}
              disabled={disabled}
              aria-label={dir}
              onClick={() => {
                if (disabled) return
                onSelectRecent(dir)
              }}
            >
              <Flex gap="xs" align="center" className="min-w-0">
                <IconFolder size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
                <Stack gap={0} className="min-w-0 flex-1">
                  <Text size="sm" truncate>
                    {getDirectoryName(dir)}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {dir}
                  </Text>
                </Stack>
              </Flex>
            </UnstyledButton>
          ))}
        </>
      )}
      <Group justify="center" py="md">
        <Button
          size="xs"
          variant="light"
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            onAdd()
          }}
        >
          <PlusIcon size={14} className="mr-1" />
          {t('Add Folder')}
        </Button>
      </Group>
    </>
  )
}
