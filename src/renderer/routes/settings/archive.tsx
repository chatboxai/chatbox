import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex, Group, Loader, Stack, Text, Title } from '@mantine/core'
import type { SessionMetaRecord } from '@shared/types'
import { IconArchiveOff, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantAvatar } from '@/components/common/Avatar'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { confirmSessionDeletion } from '@/presentation/session/session-deletion-confirmation'
import { rendererApplication } from '@/app/renderer-application'
import { deleteAllArchivedSessions, deleteSession } from '@/stores/session/crud'

const useArchivedSessionList = () => rendererApplication.sessionHooks.useArchivedSessionList()

export const Route = createFileRoute('/settings/archive')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { archivedSessionMetaList, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useArchivedSessionList()
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(() => new Set())
  const [deletingAll, setDeletingAll] = useState(false)
  const hasArchivedSessions = Boolean(archivedSessionMetaList?.length)

  const setSessionBusy = (sessionId: string, busy: boolean) => {
    setBusySessionIds((current) => {
      const next = new Set(current)
      if (busy) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
      return next
    })
  }

  return (
    <Stack p="md" gap="xl">
      <Stack gap="xxs">
        <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
          <Title order={5}>{t('Archived Chats')}</Title>
          {hasArchivedSessions && (
            <Button
              variant="subtle"
              color="red"
              size="xs"
              loading={deletingAll}
              onClick={async () => {
                const confirmed = await NiceModal.show('confirm', {
                  title: t('Delete all archived chats?'),
                  message: t('This will permanently delete every archived chat. This cannot be undone.'),
                  confirmText: t('Delete All'),
                  danger: true,
                })
                if (confirmed !== true) {
                  return
                }
                setDeletingAll(true)
                try {
                  await deleteAllArchivedSessions()
                } catch (error) {
                  console.error('Failed to delete all archived sessions:', error)
                  setDeletingAll(false)
                }
              }}
            >
              {t('Delete All')}
            </Button>
          )}
        </Group>
        <Text size="sm" c="chatbox-tertiary">
          {t('Archived chats are hidden from the chat list. You can restore or permanently delete them here.')}
        </Text>
      </Stack>

      {isLoading ? (
        <Flex justify="center" py="xl">
          <Loader size="sm" />
        </Flex>
      ) : archivedSessionMetaList?.length ? (
        <Stack gap={0}>
          {archivedSessionMetaList.map((session) => (
            <ArchivedSessionRow
              key={session.id}
              session={session}
              busy={deletingAll || busySessionIds.has(session.id)}
              setSessionBusy={setSessionBusy}
            />
          ))}
          {hasNextPage && (
            <Flex justify="center" py="md">
              <Button
                variant="subtle"
                color="chatbox-tertiary"
                loading={isFetchingNextPage}
                onClick={() => {
                  void fetchNextPage()
                }}
              >
                {t('Load More')}
              </Button>
            </Flex>
          )}
        </Stack>
      ) : (
        <Stack align="center" gap="sm" py="xl">
          <Text c="chatbox-tertiary">{t('No archived chats')}</Text>
        </Stack>
      )}
    </Stack>
  )
}

function ArchivedSessionRow({
  session,
  busy,
  setSessionBusy,
}: {
  session: SessionMetaRecord
  busy: boolean
  setSessionBusy: (sessionId: string, busy: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Flex
      key={session.id}
      align="center"
      gap="sm"
      py="sm"
      className="border-0 border-b border-solid border-chatbox-border-primary"
    >
      <AssistantAvatar
        avatarKey={session.assistantAvatarKey}
        picUrl={session.picUrl}
        sessionType={session.type}
        size="sm"
        type="chat"
        c="chatbox-primary"
      />
      <Text flex={1} lineClamp={1}>
        {session.name}
      </Text>
      <Group gap={4}>
        <Tooltip label={t('Restore')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            loading={busy}
            onClick={async () => {
              setSessionBusy(session.id, true)
              try {
                await rendererApplication.sessions.restoreSession(session.id)
              } catch (error) {
                console.error('Failed to restore archived session:', error)
                setSessionBusy(session.id, false)
              }
            }}
          >
            <ScalableIcon icon={IconArchiveOff} size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Delete')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="red"
            disabled={busy}
            onClick={async () => {
              if (!(await confirmSessionDeletion(session.id))) {
                return
              }
              setSessionBusy(session.id, true)
              try {
                await deleteSession(session.id)
              } catch (error) {
                console.error('Failed to delete archived session:', error)
                setSessionBusy(session.id, false)
              }
            }}
          >
            <ScalableIcon icon={IconTrash} size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Flex>
  )
}
