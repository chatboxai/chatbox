import {
  SessionRowConflictError,
  type SessionBranchPreview,
  type SessionForkOptionsPage,
  type SessionGenerationControl,
} from '@chatbox/core/ports'
import { getSessionActionGate, type SessionLockState } from '@chatbox/core/session/action-gates'
import { isActionAvailableInMode, type SessionMode } from '@chatbox/core/session/mode-policy'
import type { MessageRowMetadata } from '@chatbox/core/session/session-tree'
import { ActionIcon, Box, Button, Flex, Loader, Stack, Text, Tooltip } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import type { SessionType } from '@shared/types'
import { IconAlignRight, IconChevronLeft, IconChevronRight, IconFold, IconTrash } from '@tabler/icons-react'
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererApplication } from '@/app/renderer-application'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { deleteFork, switchFork, switchForkTo } from '@/stores/session/forks'
import { getSessionLockNotice, notifySessionLockBlocked } from '@/utils/session-lock-copy'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import Message from './Message'

type ForkGroupProps = {
  sessionId: string
  sessionType: SessionType
  msgId: string
  fork: NonNullable<MessageRowMetadata['fork']>
  liveMessages: SessionGenerationControl['cancellableMessages']
  sessionLocks: SessionLockState
  sessionMode?: SessionMode
  assistantAvatarKey?: string
  sessionPicUrl?: string
}

type Branch = SessionForkOptionsPage['branches'][number]
type RevealedMessages = Map<string, Set<string>>

function liveReveals(messages: SessionGenerationControl['cancellableMessages']): RevealedMessages {
  const result: RevealedMessages = new Map()
  for (const message of messages) {
    if (!message.branchId) continue
    let ids = result.get(message.branchId)
    if (!ids) {
      ids = new Set()
      result.set(message.branchId, ids)
    }
    ids.add(message.messageId)
  }
  return result
}

export default function ForkGroup(props: ForkGroupProps) {
  const { sessionId, sessionType, msgId, fork, sessionLocks, sessionMode = 'chat' } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const queryClient = useQueryClient()
  const liveMessages = useMemo(
    () =>
      props.liveMessages.filter(
        (message) => message.forkPivotId === fork.pivotId && message.branchId !== fork.selectedBranchId
      ),
    [props.liveMessages, fork.pivotId, fork.selectedBranchId]
  )
  const [expanded, setExpanded] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [revealedBranchIds, setRevealedBranchIds] = useState(() => new Set(liveReveals(liveMessages).keys()))
  const [revealedMessages, setRevealedMessages] = useState(() => liveReveals(liveMessages))
  const [newBranchStart, setNewBranchStart] = useState<number | null>(null)
  const previousFork = useRef({ count: fork.count, selectedBranchId: fork.selectedBranchId })
  const needOptions = expanded || revealedBranchIds.size > 0 || newBranchStart !== null || liveMessages.length > 0
  const options = rendererApplication.sessionHooks.useSessionForks(sessionId, needOptions ? fork.pivotId : null)
  const switchGate = getSessionActionGate('switch-fork', sessionLocks, { sessionMode })
  const forkControlsLocked = !switchGate.allowed
  const lockReason = switchGate.allowed ? '' : getSessionLockNotice(switchGate.reason, t)
  const deleteGate = getSessionActionGate('delete-fork', sessionLocks, { sessionMode })
  const deleteLocked = !deleteGate.allowed

  useEffect(() => {
    const previous = previousFork.current
    const currentLive = liveReveals(liveMessages)
    if (previous.selectedBranchId !== fork.selectedBranchId) {
      setExpanded(false)
      setNewBranchStart(null)
      setRevealedBranchIds(new Set(currentLive.keys()))
      setRevealedMessages(currentLive)
    } else {
      if (fork.count > previous.count)
        setNewBranchStart((current) => Math.min(current ?? previous.count, previous.count))
      if (currentLive.size) {
        setRevealedBranchIds((current) => {
          const added = [...currentLive.keys()].filter((id) => !current.has(id))
          return added.length ? new Set([...current, ...added]) : current
        })
        setRevealedMessages((current) => {
          let next = current
          for (const [branchId, ids] of currentLive) {
            const existing = current.get(branchId)
            if (existing && [...ids].every((id) => existing.has(id))) continue
            if (next === current) next = new Map(current)
            next.set(branchId, new Set([...(existing ?? []), ...ids]))
          }
          return next
        })
      }
    }
    previousFork.current = { count: fork.count, selectedBranchId: fork.selectedBranchId }
  }, [fork.count, fork.selectedBranchId, liveMessages])

  const previousCount = useRef(fork.count)
  useEffect(() => {
    const added = fork.count > previousCount.current
    previousCount.current = fork.count
    if (!added) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 2000)
    return () => clearTimeout(timer)
  }, [fork.count])

  useEffect(() => {
    if (needOptions && options.hasNextPage && !options.isFetchingNextPage && !options.isError)
      void options.fetchNextPage()
  }, [needOptions, options.hasNextPage, options.isFetchingNextPage, options.isError, options.fetchNextPage])

  useEffect(() => {
    if (
      newBranchStart === null ||
      options.isLoading ||
      options.hasNextPage ||
      options.isError ||
      options.branches.length < fork.count
    )
      return
    const added = options.branches.filter((branch, index) => index >= newBranchStart && !branch.selected)
    setRevealedBranchIds((current) => new Set([...current, ...added.map((branch) => branch.branchId)]))
    setNewBranchStart(null)
  }, [newBranchStart, options.branches, options.isLoading, options.hasNextPage, options.isError, fork.count])

  const switchTo = useCallback(
    async (target: 'next' | 'prev' | { branchId: string }) => {
      if (switching) return
      if (!switchGate.allowed) {
        void notifySessionLockBlocked(switchGate.reason, t)
        return
      }
      setSwitching(true)
      setSwitchError(null)
      try {
        if (typeof target === 'string') await switchFork(sessionId, fork.pivotId, target)
        else await switchForkTo(sessionId, fork.pivotId, target.branchId)
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : String(error))
      } finally {
        setSwitching(false)
      }
    },
    [switchGate, t, sessionId, fork.pivotId, switching]
  )

  const alternativeEntries = options.branches
    .map((branch, index) => ({ branch, index }))
    .filter(({ branch }) => !branch.selected && branch.firstMessageId)
  const previewQueries = useQueries({
    queries: alternativeEntries.map(({ branch }) => ({
      queryKey: ['session-branch-preview', sessionId, fork.pivotId, branch.firstMessageId],
      queryFn: async () => {
        const preview = await rendererApplication.sessions.readSessionBranchPreview({
          sessionId,
          firstMessageId: branch.firstMessageId!,
          revealedMessageIds: [...(revealedMessages.get(branch.branchId) ?? [])],
        })
        if (!preview) throw new Error('Conversation no longer exists')
        return preview
      },
      enabled: needOptions,
      staleTime: Infinity,
      gcTime: 0,
      retry: (failures: number, error: Error) => error instanceof SessionRowConflictError && failures < 2,
      retryDelay: 0,
      networkMode: 'always' as const,
    })),
  })
  const previews = useRef(previewQueries)
  previews.current = previewQueries
  useEffect(() => {
    let disposed = false
    let pending = Promise.resolve()
    const queryKey = ['session-branch-preview', sessionId, fork.pivotId]
    const unsubscribe = rendererApplication.sessionQueryBridge.subscribeCommits(sessionId, (delta) => {
      const structural =
        delta.structureResult ||
        delta.diff.messages.delete.length ||
        delta.diff.deleteSessionMessages ||
        delta.diff.deleteSubtrees?.length
      if (structural) {
        pending = pending.then(async () => {
          await queryClient.cancelQueries({ queryKey })
          if (!disposed) await queryClient.refetchQueries({ queryKey, type: 'active' })
        })
      } else {
        for (const query of previews.current)
          if (!query.isFetching && query.isError && query.error instanceof SessionRowConflictError) void query.refetch()
      }
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [queryClient, sessionId, fork.pivotId])
  const revealKeys = alternativeEntries
    .map(({ branch }) => `${branch.branchId}:${[...(revealedMessages.get(branch.branchId) ?? [])].join(',')}`)
    .join('\0')
  const previousRevealKeys = useRef(new Map<string, string>())
  useEffect(() => {
    alternativeEntries.forEach(({ branch }) => {
      const ids = [...(revealedMessages.get(branch.branchId) ?? [])].join('\0')
      const previous = previousRevealKeys.current.get(branch.branchId)
      if (previous !== undefined && previous !== ids) {
        const queryKey = ['session-branch-preview', sessionId, fork.pivotId, branch.firstMessageId]
        void queryClient
          .cancelQueries({ queryKey, exact: true })
          .then(() => queryClient.refetchQueries({ queryKey, exact: true, type: 'active' }))
      }
      previousRevealKeys.current.set(branch.branchId, ids)
    })
  }, [revealKeys, queryClient, sessionId, fork.pivotId])
  const alternativeBranches = alternativeEntries
    .map((entry, index) => ({ ...entry, query: previewQueries[index] }))
    .filter(({ query }) => !query.data || query.data.headMessageId)
  const visibleBranches = alternativeBranches
    .filter(({ branch }) => expanded || revealedBranchIds.has(branch.branchId))
    .reverse()

  const navigation = (
    <Flex gap="xs" align="center">
      <ActionIcon
        data-testid={TestId.message.forkPrevious}
        loading={switching}
        aria-busy={switching || undefined}
        variant="subtle"
        size={20}
        radius="lg"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        aria-label={forkControlsLocked ? lockReason : t('Previous reply')}
        aria-disabled={forkControlsLocked}
        data-disabled={forkControlsLocked || undefined}
        onClick={() => switchTo('prev')}
      >
        <IconChevronLeft />
      </ActionIcon>
      <ActionMenu
        position="bottom"
        items={[
          ...(!expanded ? [{ text: t('Expand view'), icon: IconAlignRight, onClick: () => setExpanded(true) }] : []),
          ...(expanded || revealedBranchIds.size > 0
            ? [
                {
                  text: t('Collapse other branches'),
                  icon: IconFold,
                  onClick: () => {
                    setExpanded(false)
                    setRevealedBranchIds(new Set())
                    setRevealedMessages(new Map())
                    setNewBranchStart(null)
                  },
                },
              ]
            : []),
          ...(supportsSessionGeneration(sessionType) && isActionAvailableInMode('delete-fork', sessionMode)
            ? ([
                { divider: true },
                {
                  doubleCheck: !deleteLocked,
                  text: t('delete'),
                  icon: IconTrash,
                  disabled: deleteLocked && !isSmallScreen,
                  testId: TestId.message.forkDelete,
                  confirmTestId: TestId.message.forkDeleteConfirm,
                  onClick: () => {
                    if (!deleteGate.allowed) {
                      void notifySessionLockBlocked(deleteGate.reason, t)
                      return
                    }
                    void deleteFork(sessionId, fork.pivotId)
                  },
                },
              ] satisfies ActionMenuItemProps[])
            : []),
        ]}
      >
        <Text
          data-testid={TestId.message.forkCounter}
          c={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
          size="xs"
          className="cursor-pointer"
        >
          {fork.position + 1} / {fork.count}
        </Text>
      </ActionMenu>
      <ActionIcon
        data-testid={TestId.message.forkNext}
        loading={switching}
        aria-busy={switching || undefined}
        variant="subtle"
        size={20}
        radius="lg"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        aria-label={forkControlsLocked ? lockReason : t('Next reply')}
        aria-disabled={forkControlsLocked}
        data-disabled={forkControlsLocked || undefined}
        onClick={() => switchTo('next')}
      >
        <IconChevronRight />
      </ActionIcon>
    </Flex>
  )
  return (
    <Stack data-testid={TestId.message.forkGroup} data-message-id={msgId} gap="xs">
      {switchError && (
        <Text role="alert" size="xs" c="chatbox-error">
          {switchError}
        </Text>
      )}
      <Flex justify="flex-end" pr="md" mr="md" className="self-end">
        {forkControlsLocked && !isSmallScreen ? (
          <Tooltip label={lockReason} withArrow>
            <Box className="inline-flex">{navigation}</Box>
          </Tooltip>
        ) : (
          navigation
        )}
      </Flex>
      {needOptions && options.isLoading && <Loader size="xs" />}
      {needOptions && options.isError && <Button onClick={() => void options.refetch()}>{t('Try Again')}</Button>}
      {visibleBranches.map(({ branch, index, query }) => (
        <BranchPreview
          key={branch.branchId}
          {...props}
          branch={branch}
          index={index}
          query={query}
          revealedMessageIds={[...(revealedMessages.get(branch.branchId) ?? [])]}
          switchTo={() => switchTo({ branchId: branch.branchId })}
          forkControlsLocked={forkControlsLocked}
          lockReason={lockReason}
          isSmallScreen={isSmallScreen}
        />
      ))}
      {visibleBranches.length > 0 &&
        visibleBranches.length < alternativeBranches.length &&
        previewQueries.every((query) => !query.isLoading) && (
          <Flex justify="flex-end" pr="md" mr="md">
            <Text size="xs" c="chatbox-tertiary">
              {t('Showing {{shown}} of {{total}} other replies', {
                shown: visibleBranches.length,
                total: alternativeBranches.length,
              })}
            </Text>
          </Flex>
        )}
    </Stack>
  )
}

function BranchPreview(
  props: ForkGroupProps & {
    branch: Branch
    index: number
    query: UseQueryResult<SessionBranchPreview, Error>
    revealedMessageIds: string[]
    switchTo(): void
    forkControlsLocked: boolean
    lockReason: string
    isSmallScreen: boolean
  }
) {
  const { t } = useTranslation()
  const query = props.query
  const preview = query.data
  if (!preview)
    return query.isError ? <Button onClick={() => void query.refetch()}>{t('Try Again')}</Button> : <Loader size="xs" />
  if (!preview.headMessageId) return null
  const previewIds = new Set([preview.headMessageId, preview.pairedReplyMessageId])
  const followups = (preview.revealedMessageIds ?? props.revealedMessageIds).filter((id) => !previewIds.has(id))
  const followupCount = Math.max(0, preview.followupCount - followups.length)
  const switchButton = (
    <Button
      variant="subtle"
      color="chatbox-brand"
      size="compact-xs"
      disabled={props.forkControlsLocked && !props.isSmallScreen}
      aria-disabled={props.forkControlsLocked}
      onClick={props.switchTo}
    >
      {t('Switch to this branch')}
    </Button>
  )
  return (
    <Stack
      gap={0}
      mx="md"
      p="xs"
      className="rounded-lg border border-solid border-chatbox-border-primary bg-chatbox-background-primary shadow-sm"
    >
      <Flex justify="space-between" align="center" gap="xs" wrap="wrap" px="xs" pb="xxs">
        <Text size="xs" c="chatbox-tertiary">
          {preview.headRole === 'user'
            ? t('Branch {{index}}', { index: props.index + 1 })
            : t('Reply {{index}}', { index: props.index + 1 })}
        </Text>
        <Flex gap="xs" align="center" justify="flex-end" wrap="wrap">
          {followupCount > 0 && (
            <Text size="xs" c="chatbox-tertiary">
              {followupCount === 1
                ? t('1 follow-up message')
                : t('{{count}} follow-up messages', { count: followupCount })}
            </Text>
          )}
          {props.forkControlsLocked && !props.isSmallScreen ? (
            <Tooltip label={props.lockReason} withArrow>
              <span>{switchButton}</span>
            </Tooltip>
          ) : (
            switchButton
          )}
        </Flex>
      </Flex>
      <PreviewMessage {...props} messageId={preview.headMessageId} />
      {preview.pairedReplyMessageId && <PreviewMessage {...props} messageId={preview.pairedReplyMessageId} />}
      {followups.map((id) => (
        <PreviewMessage key={id} {...props} messageId={id} />
      ))}
    </Stack>
  )
}

function PreviewMessage(props: ForkGroupProps & { messageId: string }) {
  const { t } = useTranslation()
  const query = rendererApplication.sessionHooks.useSessionMessage(props.sessionId, props.messageId)
  if (query.isLoading) return <Loader size="xs" />
  if (query.isError) return <Button onClick={() => void query.refetch()}>{t('Try Again')}</Button>
  return query.message ? (
    <Message
      id={query.message.id}
      msg={query.message}
      sessionId={props.sessionId}
      sessionType={props.sessionType}
      buttonGroup="none"
      readOnly
      allowGeneratingStop
      sessionLocks={props.sessionLocks}
      sessionMode={props.sessionMode}
      assistantAvatarKey={props.assistantAvatarKey}
      sessionPicUrl={props.sessionPicUrl}
    />
  ) : null
}
