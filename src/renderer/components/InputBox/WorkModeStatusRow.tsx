import { Divider, Flex, Popover, Stack, Text, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { CommandApprovalMode } from '@shared/types'
import { IconCode, IconDeviceFloppy, IconFolderCog } from '@tabler/icons-react'
import { type ComponentPropsWithoutRef, type FC, forwardRef, type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { CommandApprovalOptions, WorkingDirectoryContent } from './AgentModeSettingsContent'
import { useComposerMenuStore } from './composerMenuStore'
import {
  getDirectoryName,
  supportsWorkingDirectories,
  useCommandApprovalModeState,
  useWorkingDirectoriesState,
} from './useAgentModeSettingsState'

export interface WorkModeStatusRowProps {
  sessionId: string
  providerId?: string
  modelId?: string
}

const APPROVAL_MODE_LABEL_KEYS: Record<CommandApprovalMode, string> = {
  always_ask: 'Always Ask',
  smart: 'Smart Approval',
  full_access: 'Full Access',
}

// Preferred width clamped to the viewport: the desktop window can shrink to 280px
// (src/main/window_state.ts), where a fixed 300px dropdown would be clipped.
const STATUS_MENU_WIDTH = 'min(300px, calc(100vw - 24px))'

type StatusChipProps = {
  opened: boolean
  danger?: boolean
  testId?: string
  ariaLabel: string
  onClick: () => void
  children: ReactNode
} & ComponentPropsWithoutRef<'button'>

// forwardRef + prop spreading so the chip can sit directly inside Popover.Target.
// Spread injected props first and merge className manually: Popover.Target clones the
// element with its own (possibly undefined) className, which would clobber ours.
const StatusChip = forwardRef<HTMLButtonElement, StatusChipProps>(
  ({ opened, danger = false, testId, ariaLabel, onClick, children, className, ...others }, ref) => (
    <UnstyledButton
      ref={ref}
      {...others}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-expanded={opened}
      aria-haspopup="menu"
      onClick={onClick}
      className={`${className ?? ''} flex min-w-0 items-center gap-[5px] rounded-md px-1.5 py-0.5 transition-colors hover:bg-[var(--chatbox-background-tertiary)] ${
        opened ? 'bg-[var(--chatbox-background-tertiary)]' : ''
      }`}
      style={{
        color: danger
          ? 'var(--chatbox-tint-error)'
          : opened
            ? 'var(--chatbox-tint-primary)'
            : 'var(--chatbox-tint-secondary)',
      }}
    >
      {children}
    </UnstyledButton>
  )
)
StatusChip.displayName = 'StatusChip'

/**
 * Composer status row (Work Mode only): surfaces the command-approval policy and
 * bound working directories right above the toolbar. Each chip opens its own small
 * menu mirroring the matching Work Mode panel sub-page — same session settings,
 * two entry points, always in sync.
 */
const WorkModeStatusRow: FC<WorkModeStatusRowProps> = ({ sessionId, providerId, modelId }) => {
  const { t } = useTranslation()
  const isNewSession = sessionId === 'new'
  // Menu open state lives in the shared composer-menu slot so the chip menus and the
  // Work Mode hover panel are mutually exclusive — they overlap the same area.
  const activeMenu = useComposerMenuStore((s) => s.activeMenu)
  const openMenu = useComposerMenuStore((s) => s.openMenu)
  const closeMenu = useComposerMenuStore((s) => s.closeMenu)
  const approvalMenuOpened = activeMenu === 'approval-status'
  const directoryMenuOpened = activeMenu === 'working-dir-status'

  // The store is module-level, so release the slot if one of this row's menus still owns
  // it on unmount (session switch, leaving Work Mode) — a stale chip-menu id would keep
  // suppressing the next composer's Work Mode panel.
  useEffect(
    () => () => {
      const { closeMenu: release } = useComposerMenuStore.getState()
      release('approval-status')
      release('working-dir-status')
    },
    []
  )

  const { commandApprovalMode, updateCommandApprovalMode } = useCommandApprovalModeState(sessionId, {
    providerId,
    modelId,
  })
  const {
    workingDirectories,
    availableRecentDirectories,
    addWorkingDirectory,
    selectRecentDirectory,
    removeWorkingDirectory,
  } = useWorkingDirectoriesState(sessionId)

  // "Same as last time" only on a fresh chat that inherited remembered defaults untouched.
  const newSessionState = useUIStore((s) => s.newSessionState)
  const rememberedApprovalMode = useUIStore((s) => s.newSessionCommandApprovalModeDefault)
  const rememberedDirectories = useUIStore((s) => s.newSessionWorkingDirectoriesDefault)
  const showInheritedHint =
    isNewSession &&
    !newSessionState.commandApprovalMode &&
    !newSessionState.workingDirectories &&
    (rememberedApprovalMode !== undefined || (rememberedDirectories?.length ?? 0) > 0)

  const isFullAccess = commandApprovalMode === 'full_access'
  const firstDirectory = workingDirectories[0]
  const extraDirectoryCount = Math.max(0, workingDirectories.length - 1)

  return (
    <Flex
      align="center"
      gap={2}
      className="w-full min-w-0 pb-1.5"
      style={{ borderBottom: '0.5px solid var(--chatbox-border-primary)' }}
    >
      <Popover
        opened={approvalMenuOpened}
        onChange={(opened) => (opened ? openMenu('approval-status') : closeMenu('approval-status'))}
        position="top-start"
        width={STATUS_MENU_WIDTH}
        shadow="md"
        transitionProps={{ transition: 'pop', duration: 200 }}
      >
        <Popover.Target>
          <StatusChip
            opened={approvalMenuOpened}
            danger={isFullAccess}
            testId={TestId.agent.approvalStatusTrigger}
            ariaLabel={t('Code Execution')}
            onClick={() => (approvalMenuOpened ? closeMenu('approval-status') : openMenu('approval-status'))}
          >
            <IconCode
              size={14}
              className={`shrink-0 ${
                isFullAccess
                  ? ''
                  : approvalMenuOpened
                    ? 'text-[var(--chatbox-tint-secondary)]'
                    : 'text-[var(--chatbox-tint-tertiary)]'
              }`}
            />
            {/* Font class lives on the span: Mantine's UnstyledButton pins its own font-size (md),
                so a text class on the button itself loses the cascade. Labels truncate so the
                row still fits the 280px minimum window. */}
            <span className="min-w-0 truncate text-xs">{t(APPROVAL_MODE_LABEL_KEYS[commandApprovalMode])}</span>
          </StatusChip>
        </Popover.Target>
        <Popover.Dropdown p={0} data-testid={TestId.agent.approvalStatusMenu}>
          <Stack gap={0} py="xs">
            <Flex justify="space-between" align="center" px="sm" pb="xs">
              <Text fw={600} size="sm">
                {t('Code Execution')}
              </Text>
            </Flex>
            <Divider mb={4} />
            <CommandApprovalOptions
              mode={commandApprovalMode}
              onSelect={(mode) => {
                void updateCommandApprovalMode(mode)
                closeMenu('approval-status')
              }}
            />
            <Divider my={4} />
            <Flex align="center" gap={6} px="sm" pt={2}>
              <IconDeviceFloppy size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
              <Text size="xs" c="chatbox-tertiary">
                {t('New chats will keep this choice')}
              </Text>
            </Flex>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      {supportsWorkingDirectories() && (
        <>
          <span className="mx-1 h-3 w-[0.5px] shrink-0 bg-[var(--chatbox-border-secondary)]" />
          <Popover
            opened={directoryMenuOpened}
            onChange={(opened) => (opened ? openMenu('working-dir-status') : closeMenu('working-dir-status'))}
            position="top-start"
            width={STATUS_MENU_WIDTH}
            shadow="md"
            transitionProps={{ transition: 'pop', duration: 200 }}
          >
            <Popover.Target>
              <StatusChip
                opened={directoryMenuOpened}
                testId={TestId.agent.workingDirStatusTrigger}
                ariaLabel={t('Working Directory')}
                onClick={() => (directoryMenuOpened ? closeMenu('working-dir-status') : openMenu('working-dir-status'))}
              >
                <IconFolderCog
                  size={14}
                  className={`shrink-0 ${
                    directoryMenuOpened ? 'text-[var(--chatbox-tint-secondary)]' : 'text-[var(--chatbox-tint-tertiary)]'
                  }`}
                />
                <span className="min-w-0 max-w-40 truncate text-xs">
                  {firstDirectory ? getDirectoryName(firstDirectory) : t('Working Directory')}
                </span>
                {extraDirectoryCount > 0 && (
                  <span className="shrink-0 text-[11px] text-[var(--chatbox-tint-tertiary)]">
                    +{extraDirectoryCount}
                  </span>
                )}
              </StatusChip>
            </Popover.Target>
            {/* The directory list is unbounded — cap the menu like the panel sub-page does. */}
            <Popover.Dropdown
              p={0}
              className="max-h-[360px] overflow-y-auto"
              data-testid={TestId.agent.workingDirStatusMenu}
            >
              <Stack gap={0} py="xs">
                <Flex justify="space-between" align="center" px="sm" pb="xs">
                  <Text fw={600} size="sm">
                    {t('Working Directory')}
                  </Text>
                </Flex>
                <Divider mb={4} />
                <WorkingDirectoryContent
                  workingDirectories={workingDirectories}
                  availableRecentDirectories={availableRecentDirectories}
                  onRemove={(dir) => void removeWorkingDirectory(dir)}
                  onSelectRecent={(dir) => void selectRecentDirectory(dir)}
                  onAdd={() => void addWorkingDirectory()}
                />
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </>
      )}

      {showInheritedHint && (
        <span className="ml-1.5 min-w-0 truncate text-[11px] text-[var(--chatbox-tint-tertiary)]">
          {t('Same as last time')}
        </span>
      )}
    </Flex>
  )
}

export default WorkModeStatusRow
